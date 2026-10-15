(function () {
    'use strict';
    // Batch D: extracted verbatim from the validated Batch C application.
    window.TimePlanCore = window.TimePlanCore || {};
    window.TimePlanCore.createRosterProcessing = function (deps) {
        const { getDateKey, sortWorkersByStart } = deps;

    function normalizeWorktimesResponse(json) {
        if (Array.isArray(json)) return json;
        for (const key of ['data', 'result', 'results']) {
            if (Array.isArray(json?.[key])) return json[key];
        }
        for (const value of Object.values(json || {})) {
            if (Array.isArray(value) && value.some(item => item?.employee_name)) return value;
        }
        throw new Error('Could not recognize DepartmentWorktimes response.');
    }

    function normalizeAbsenceResponse(json) {
        if (Array.isArray(json)) return json;
        for (const key of ['data', 'result', 'results']) {
            if (Array.isArray(json?.[key])) return json[key];
        }
        const found = [];
        function search(value) {
            if (!value) return;
            if (Array.isArray(value)) return value.forEach(search);
            if (typeof value === 'object') {
                if (value.employeeid !== undefined && value.from && value.to && value.allday !== undefined) {
                    found.push(value);
                    return;
                }
                Object.values(value).forEach(search);
            }
        }
        search(json);
        return found;
    }

    function mergeContiguousWorktimes(worktimes) {
        const sorted = [...(Array.isArray(worktimes) ? worktimes : [])]
            .filter(w => w?.start_time && w?.end_time)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const merged = [];

        sorted.forEach(worktime => {
            const copy = { ...worktime, details: [...(worktime.details || [])] };
            const last = merged[merged.length - 1];
            if (!last) return merged.push(copy);

            const sameDate = getDateKey(last.start_time) === getDateKey(copy.start_time);
            const contiguous = last.end_time === copy.start_time;
            if (sameDate && contiguous) {
                last.end_time = copy.end_time;
                last.details.push(...(copy.details || []));
            } else {
                merged.push(copy);
            }
        });
        return merged;
    }

    function mergeFunctionSegments(segments) {
        const sorted = [...segments].sort((a, b) => a.start.localeCompare(b.start));
        const merged = [];
        sorted.forEach(segment => {
            const last = merged[merged.length - 1];
            if (last && String(last.id) === String(segment.id) && last.end === segment.start) {
                last.end = segment.end;
            } else {
                merged.push({ ...segment });
            }
        });
        return merged;
    }

    function getFunctionSegments(worktime, functionMap) {
        return mergeFunctionSegments((worktime.details || [])
            .filter(detail => detail?.function_id !== undefined)
            .map(detail => {
                const mapped = functionMap[String(detail.function_id)];
                return {
                    id: detail.function_id,
                    name: mapped?.name || `Function ${detail.function_id}`,
                    color: mapped?.color || '#666666',
                    start: detail.start_time,
                    end: detail.end_time
                };
            }));
    }

    function getAbsenceActivityText(absence) {
        // TimePlan does not always expose the activity name (for example
        // "Oplæring") as a top-level DepartmentAbsence field. In some responses
        // it is nested inside an activity/type object. Collect string values
        // recursively so training can be recognised regardless of that shape.
        const strings = [];
        const seen = new Set();

        function collect(value, depth = 0) {
            if (value == null || depth > 6) return;
            if (typeof value === 'string') {
                const text = value.trim();
                if (text) strings.push(text);
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) {
                value.forEach(item => collect(item, depth + 1));
                return;
            }
            Object.values(value).forEach(item => collect(item, depth + 1));
        }

        collect(absence);
        return strings.join(' ').toLowerCase();
    }

    function isTrainingActivity(absence) {
        const text = getAbsenceActivityText(absence);
        if (!text) return false;

        // Oplæring is training, not operational absence. TimePlan may still send
        // physicallyPresent=false/all-day for it, but the coworker's Working time
        // must remain visible in Sorted View and Board Planning.
        return /(?:^|\b)(oplæring|oplaering|training)(?:\b|$)/i.test(text);
    }

    // F.14.3: Working exceptions stay visible; only meetings generate ABS among them.
    // Only full-shift absences outside these explicit working exceptions hide a coworker.
    function isWorkingException(absence) {
        const text = getAbsenceActivityText(absence);
        return isTrainingActivity(absence) || /ansvarstid|internt\s+møde|internt\s+moede|til\s+r[aå]dighed(?:\s*[-–]\s*available)?/i.test(text);
    }

    function isMeeting(absence) {
        return /internt\s+møde|internt\s+moede/i.test(getAbsenceActivityText(absence));
    }

    function overlapsShift(absence, worktime) {
        return absence.from < worktime.end_time && absence.to > worktime.start_time;
    }

    function coversShift(absence, worktime) {
        return absence.from <= worktime.start_time && absence.to >= worktime.end_time;
    }

    function isFullShiftAbsence(absence, worktime) {
        return absence.allday === true || coversShift(absence, worktime);
    }

    function buildUnavailableAbsences(absences) {
        // Keep raw records: full-vs-partial is assessed against each individual shift.
        return absences.filter(absence =>
            absence.employeeid !== undefined && absence.from && absence.to
        );
    }

    function maxTimestamp(a, b) { return a > b ? a : b; }
    function minTimestamp(a, b) { return a < b ? a : b; }

    function clipWorktimeDetails(details, start, end) {
        return (details || []).
            filter(detail => detail?.start_time && detail?.end_time).
            map(detail => {
                const clippedStart = maxTimestamp(detail.start_time, start);
                const clippedEnd = minTimestamp(detail.end_time, end);
                if (clippedStart >= clippedEnd) return null;
                return { ...detail, start_time: clippedStart, end_time: clippedEnd };
            }).
            filter(Boolean);
    }

    function subtractAbsencesFromWorktime(worktime, employeeId, absences) {
        let blocks = [{
            ...worktime,
            details: [...(worktime.details || [])]
        }];

        const relevantAbsences = absences
            .filter(absence =>
                String(absence.employeeid) === String(employeeId) &&
                absence.from < worktime.end_time &&
                absence.to > worktime.start_time
            )
            .sort((a, b) => a.from.localeCompare(b.from));

        relevantAbsences.forEach(absence => {
            const nextBlocks = [];

            blocks.forEach(block => {
                const absenceStart = maxTimestamp(absence.from, block.start_time);
                const absenceEnd = minTimestamp(absence.to, block.end_time);

                if (absenceStart >= absenceEnd) {
                    nextBlocks.push(block);
                    return;
                }

                if (block.start_time < absenceStart) {
                    nextBlocks.push({
                        ...block,
                        end_time: absenceStart,
                        details: clipWorktimeDetails(block.details, block.start_time, absenceStart)
                    });
                }

                if (absenceEnd < block.end_time) {
                    nextBlocks.push({
                        ...block,
                        start_time: absenceEnd,
                        details: clipWorktimeDetails(block.details, absenceEnd, block.end_time)
                    });
                }
            });

            blocks = nextBlocks;
        });

        return blocks.filter(block => block.start_time < block.end_time);
    }

    function getRelevantAbsencesForWorktime(worktime, employeeId, absences) {
        return absences
            .filter(absence =>
                String(absence.employeeid) === String(employeeId) &&
                absence.from < worktime.end_time &&
                absence.to > worktime.start_time
            )
            .map(absence => ({
                start: maxTimestamp(absence.from, worktime.start_time),
                end: minTimestamp(absence.to, worktime.end_time),
                allDay: absence.allday === true
            }))
            .filter(absence => absence.start < absence.end)
            .sort((a, b) => a.start.localeCompare(b.start));
    }

    function buildDays(employees, absences, functionMap, trainingActivities = [], rawAbsences = []) {
        const days = {};
        employees.forEach(employee => {
            mergeContiguousWorktimes(employee.worktimes || []).forEach(worktime => {
                const date = getDateKey(worktime.start_time);
                if (!date) return;

                const overlapping = absences.filter(absence =>
                    String(absence.employeeid) === String(employee.employee_id) &&
                    overlapsShift(absence, worktime)
                );
                // Exclude a full-day non-exception, even if TimePlan still has working hours.
                if (overlapping.some(absence =>
                    isFullShiftAbsence(absence, worktime) && !isWorkingException(absence)
                )) return;

                // Meetings show ABS for their actual interval (even if all day).
                // Oplæring, Ansvarstid and Til rådighed are working activities,
                // so they must never generate ABS, including partial intervals.
                // Other partial absences continue to show ABS as before.
                const annotated = overlapping.filter(absence =>
                    isMeeting(absence) ||
                    (!isWorkingException(absence) && !isFullShiftAbsence(absence, worktime))
                );
                const relevantAbsences = getRelevantAbsencesForWorktime(
                    worktime, employee.employee_id, annotated
                );
                const isTraining = trainingActivities.some(activity =>
                    String(activity.employeeid) === String(employee.employee_id) &&
                    overlapsShift(activity, worktime)
                );
                // If multiple partial absences jointly cover the entire shift,
                // there is no actual availability, but keep it as an annotated shift
                // per the agreed partial-absence rule.
                const effectiveBlocks = subtractAbsencesFromWorktime(
                    worktime, employee.employee_id, annotated
                );

                (days[date] ||= []).push({
                    name: employee.employee_name || 'Unknown',
                    employeeId: employee.employee_id,
                    start: worktime.start_time,
                    end: worktime.end_time,
                    effectiveStart: effectiveBlocks.length ? effectiveBlocks[0].start_time : worktime.start_time,
                    training: isTraining,
                    functionSegments: getFunctionSegments(worktime, functionMap),
                    absenceSegments: relevantAbsences.map(absence => ({
                        start: absence.start,
                        end: absence.end
                    }))
                });
            });
        });
        Object.keys(days).forEach(date => days[date] = sortWorkersByStart(days[date]));
        return days;
    }

        return { normalizeWorktimesResponse, normalizeAbsenceResponse, mergeContiguousWorktimes, mergeFunctionSegments, getFunctionSegments, getAbsenceActivityText, isTrainingActivity, isWorkingException, isMeeting, isFullShiftAbsence, buildUnavailableAbsences, maxTimestamp, minTimestamp, clipWorktimeDetails, subtractAbsencesFromWorktime, getRelevantAbsencesForWorktime, buildDays };
    };
})();
