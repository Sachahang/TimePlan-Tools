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

    // F.14: interpret the operational effect, not a private absence reason.
    function classifyAbsence(absence) {
        const text = getAbsenceActivityText(absence);
        if (/(?:^|\b)(ansvarstid)(?:\b|$)/i.test(text)) return 'working';
        if (isTrainingActivity(absence)) return 'working';
        if (/(?:øvrigt\s+fravær|ovrigt\s+fravaer|other\s+absences?)/i.test(text)) return 'unavailable';
        // Preserve the pre-F.14 handling of partial absences, including meetings.
        if (absence.allday !== true && absence.physicallyPresent === false) return 'unavailable';
        // Unknown all-day categories must NOT silently hide a scheduled worker.
        return 'information';
    }

    function getAbsenceDisplayName(absence) {
        // Read human-facing category fields only; do not expose arbitrary metadata.
        const keys = ['name', 'title', 'text', 'description', 'label', 'activity_name',
            'activityName', 'absence_name', 'absenceName', 'type_name', 'typeName'];
        const visited = new Set();
        function find(value, depth = 0) {
            if (!value || typeof value !== 'object' || visited.has(value) || depth > 4) return '';
            visited.add(value);
            for (const key of keys) {
                if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
            }
            for (const key of ['activity', 'absence', 'absenceType', 'type', 'reason']) {
                const child = value[key];
                if (typeof child === 'string' && child.trim()) return child.trim();
                const nested = find(child, depth + 1);
                if (nested) return nested;
            }
            return '';
        }
        const explicit = find(absence);
        if (explicit) return explicit;
        const text = getAbsenceActivityText(absence);
        if (/ansvarstid/i.test(text)) return 'Ansvarstid';
        if (/oplæring|oplaering|training/i.test(text)) return 'Oplæring';
        return 'Information (category not provided)';
    }

    function buildUnavailableAbsences(absences) {
        return absences.filter(absence =>
            absence.employeeid !== undefined && absence.from && absence.to &&
            classifyAbsence(absence) === 'unavailable'
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

                const relevantAbsences = getRelevantAbsencesForWorktime(
                    worktime,
                    employee.employee_id,
                    absences
                );

                const isTraining = trainingActivities.some(activity =>
                    String(activity.employeeid) === String(employee.employee_id) &&
                    activity.from < worktime.end_time &&
                    activity.to > worktime.start_time
                );

                // Keep one row/magnet per logical TimePlan shift. Absences only annotate
                // that original shift. A full-day absence, or any combination of
                // absences that leaves no effective working time, removes the shift.
                const effectiveBlocks = subtractAbsencesFromWorktime(
                    worktime,
                    employee.employee_id,
                    absences
                );

                if (!effectiveBlocks.length) return;
                // Exclude only when known unavailable intervals cover the entire shift.
                // All-day working/informational categories never enter `absences`.
                const fullDayNotes = rawAbsences.filter(absence =>
                    String(absence.employeeid) === String(employee.employee_id) &&
                    absence.allday === true && absence.from < worktime.end_time &&
                    absence.to > worktime.start_time &&
                    classifyAbsence(absence) !== 'unavailable'
                ).map(absence => getAbsenceDisplayName(absence));

                (days[date] ||= []).push({
                    name: employee.employee_name || 'Unknown',
                    employeeId: employee.employee_id,
                    start: worktime.start_time,
                    end: worktime.end_time,
                    effectiveStart: effectiveBlocks[0].start_time,
                    training: isTraining,
                    allDayAbsenceNotes: [...new Set(fullDayNotes)],
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

        return { normalizeWorktimesResponse, normalizeAbsenceResponse, mergeContiguousWorktimes, mergeFunctionSegments, getFunctionSegments, getAbsenceActivityText, isTrainingActivity, classifyAbsence, getAbsenceDisplayName, buildUnavailableAbsences, maxTimestamp, minTimestamp, clipWorktimeDetails, subtractAbsencesFromWorktime, getRelevantAbsencesForWorktime, buildDays };
    };
})();
