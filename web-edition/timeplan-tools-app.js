(function () {
    'use strict';

    const PANEL_ID = 'tp-tools-panel';
    const BUTTON_ID = 'tp-tools-button';
    const TP_BLUE = '#0058A3';
    const TP_LIGHT_BLUE = '#EAF3FA';
    const TOOL_FONT = 'Arial, Helvetica, sans-serif';

    // Capture the font from a REAL TimePlan element, not from our own panel.
    // The previous method could resolve to Arial because body / TimePlan Tools
    // itself may have an inline fallback. This deliberately ignores our UI.
    function getNativeTimePlanFontFamily() {
        const selectors = [
            'table td',
            'table th',
            '[role="gridcell"]',
            '[role="columnheader"]',
            'button',
            'label',
            'span',
            'div'
        ];

        const genericOnly = family => {
            const f = String(family || '').toLowerCase().replace(/\s+/g, '');
            return (
                f === 'arial' ||
                f === '"arial"' ||
                f === 'arial,helvetica,sans-serif' ||
                f === 'helvetica,arial,sans-serif' ||
                f === 'sans-serif'
            );
        };

        for (const selector of selectors) {
            const elements = Array.from(document.querySelectorAll(selector));

            for (const element of elements) {
                if (
                    element.closest?.(`#${PANEL_ID}`) ||
                    element.closest?.(`#${BUTTON_ID}`)
                ) {
                    continue;
                }

                const text = String(element.textContent || '').trim();
                if (!text) continue;

                const rect = element.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;

                try {
                    const family = getComputedStyle(element).fontFamily;
                    if (family && family.trim() && !genericOnly(family)) {
                        return family.trim();
                    }
                } catch {}
            }
        }

        // Last fallback: native body computed style.
        try {
            const family = getComputedStyle(document.body).fontFamily;
            if (family && family.trim()) return family.trim();
        } catch {}

        return TOOL_FONT;
    }

    function collectTimePlanFontFaceCSS() {
        const collected = [];

        function scan(rules) {
            if (!rules) return;

            for (const rule of rules) {
                try {
                    if (
                        rule.type === CSSRule.FONT_FACE_RULE ||
                        rule.constructor?.name === 'CSSFontFaceRule'
                    ) {
                        collected.push(rule.cssText);
                    } else if (rule.cssRules) {
                        scan(rule.cssRules);
                    }
                } catch {}
            }
        }

        for (const sheet of Array.from(document.styleSheets || [])) {
            try {
                scan(sheet.cssRules);
            } catch {}
        }

        return collected.join('\n');
    }

    function getPrimaryFontName(fontFamily) {
        return String(fontFamily || TOOL_FONT).split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Arial';
    }

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read font blob.'));
            reader.readAsDataURL(blob);
        });
    }

    async function inlineFontURLs(cssText, baseURL) {
        const regex = /url\((['"]?)([^'")]+)\1\)/g;
        const matches = Array.from(String(cssText || '').matchAll(regex));
        let output = String(cssText || '');

        for (const match of matches) {
            const original = match[0];
            const rawURL = match[2];
            if (!rawURL || rawURL.startsWith('data:')) continue;
            try {
                const absolute = new URL(rawURL, baseURL || location.href).href;
                const response = await fetch(absolute, { credentials: 'include' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const dataURL = await blobToDataURL(await response.blob());
                output = output.split(original).join(`url("${dataURL}")`);
            } catch {
                try {
                    const absolute = new URL(rawURL, baseURL || location.href).href;
                    output = output.split(original).join(`url("${absolute}")`);
                } catch {}
            }
        }
        return output;
    }

    async function collectPortableTimePlanFontFaceCSS(fontFamily) {
        const primary = getPrimaryFontName(fontFamily).toLowerCase();
        const collected = [];

        async function scan(rules, baseURL) {
            if (!rules) return;
            for (const rule of rules) {
                try {
                    if (
                        rule.type === CSSRule.FONT_FACE_RULE ||
                        rule.constructor?.name === 'CSSFontFaceRule'
                    ) {
                        const text = String(rule.cssText || '');
                        const familyMatch = text.match(/font-family\s*:\s*([^;}]*)/i);
                        const family = String(familyMatch?.[1] || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
                        if (family === primary) collected.push(await inlineFontURLs(text, baseURL));
                    } else if (rule.cssRules) {
                        await scan(rule.cssRules, baseURL);
                    }
                } catch {}
            }
        }

        for (const sheet of Array.from(document.styleSheets || [])) {
            try { await scan(sheet.cssRules, sheet.href || location.href); } catch {}
        }

        return collected.join('\n');
    }

    // Keep the same stylesheet files available to the standalone board.
    // This is important when the detected font is loaded by TimePlan CSS.
    function getTimePlanStylesheetLinksHTML() {
        return Array.from(
            document.querySelectorAll('link[rel="stylesheet"][href]')
        )
            .map(link => {
                try {
                    const href = new URL(link.href, location.href).href;
                    return `<link rel="stylesheet" href="${escapeHTML(href)}">`;
                } catch {
                    return '';
                }
            })
            .filter(Boolean)
            .join('\n');
    }

    function escapeStyleClose(value) {
        return String(value || '').replace(/<\/style/gi, '<\\/style');
    }

    // Full Serve configuration is maintained in src/departments/full-serve.js.
    // This module must load before the main application (see index.html).
    const fullServeDepartment = window.TimePlanFullServe;
    if (!fullServeDepartment || !fullServeDepartment.departmentId ||
        !fullServeDepartment.departmentCode || !Array.isArray(fullServeDepartment.areas)) {
        throw new Error('TimePlan Tools: Full Serve configuration module is missing or invalid.');
    }
    const BOARD_DEPARTMENT_ID = fullServeDepartment.departmentId;
    const BOARD_DEPARTMENT_CODE = fullServeDepartment.departmentCode;
    const BOARD_AREAS = fullServeDepartment.areas;

    let loadedDepartmentId = null;
    let currentDays = {};
    let selectedDate = null;
    let activeView = 'sorted';
    let draggedWorkerKey = null;
    const boardAssignments = {};
    const unassignedCollapsedByDate = {};
    const notPresentByDate = {};
    const externalWorkersByDate = {};


    // ---------- Page / API discovery ----------

    function isDepartmentPlanPage() {
        return location.hash.startsWith('#/roster/departmentplan');
    }

    function findLatestResource(fragment) {
        const matches = performance.getEntriesByType('resource').filter(e => e.name.includes(fragment));
        return matches.length ? matches[matches.length - 1].name : null;
    }

    function findDepartmentWorktimesUrl() { return findLatestResource('func=DepartmentWorktimes'); }
    function findDepartmentAbsenceUrl() { return findLatestResource('func=DepartmentAbsence'); }
    function findLoadSettingUrl() { return findLatestResource('func=LoadSetting'); }

    function getCurrentDepartmentId() {
        const worktimesUrl = findDepartmentWorktimesUrl();
        if (!worktimesUrl) return null;
        try { return new URL(worktimesUrl).searchParams.get('dept_id'); }
        catch { return null; }
    }

    function isBoardDepartment() {
        // Interactive Board eligibility is now owned by its external module.
        return window.TimePlanInteractiveBoard.isSupportedDepartment(loadedDepartmentId);
    }

    function buildAbsenceUrl(worktimesUrl) {
        const url = new URL(worktimesUrl);
        const deptId = url.searchParams.get('dept_id');
        const fromDate = url.searchParams.get('from_date');
        const days = Number(url.searchParams.get('days') || 6);
        if (!deptId || !fromDate) throw new Error('Could not determine department/date information.');

        const [y, m, d] = fromDate.substring(0, 10).split('-').map(Number);
        const end = new Date(y, m - 1, d);
        end.setDate(end.getDate() + days);
        const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T23:59:59.999`;

        const absenceUrl = new URL('/webapi/', location.origin);
        absenceUrl.searchParams.set('func', 'DepartmentAbsence');
        absenceUrl.searchParams.set('deptid', deptId);
        absenceUrl.searchParams.set('fromdate', fromDate);
        absenceUrl.searchParams.set('todate', endDate);
        return absenceUrl.toString();
    }

    function buildLoadSettingUrl() {
        const url = new URL('/webapi/', location.origin);
        url.searchParams.set('func', 'LoadSetting');
        return url.toString();
    }

    async function getJSON(url) {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`TimePlan returned HTTP ${response.status}`);
        return response.json();
    }

    // ---------- Date / time ----------

    function getDateKey(value) { return value ? value.substring(0, 10) : ''; }
    function formatTime(value) { return value ? value.substring(11, 16) : ''; }

    function timeToMinutes(value) {
        if (!value) return 0;
        return Number(value.substring(11, 13)) * 60 + Number(value.substring(14, 16));
    }

    function minutesBetween(start, end) {
        return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
    }

    function getWorkerEffectiveStart(worker) {
        return worker.effectiveStart || worker.start;
    }

    function sortWorkersByStart(workers) {
        return [...workers].sort((a, b) =>
            (timeToMinutes(getWorkerEffectiveStart(a)) - timeToMinutes(getWorkerEffectiveStart(b))) ||
            (timeToMinutes(a.start) - timeToMinutes(b.start)) ||
            (timeToMinutes(a.end) - timeToMinutes(b.end)) ||
            a.name.localeCompare(b.name)
        );
    }

    function sortWorkersByOfficialStart(workers) {
        return [...workers].sort((a, b) =>
            (timeToMinutes(a.start) - timeToMinutes(b.start)) ||
            (timeToMinutes(a.end) - timeToMinutes(b.end)) ||
            a.name.localeCompare(b.name)
        );
    }


    function isWorkerNotPresent(worker) {
        return Boolean((notPresentByDate[selectedDate] || {})[getWorkerKey(worker)]);
    }

    function getUnassignedRoleGroup(worker) {
        if (worker.isExternal) return { id: 'external-help', label: 'EXTERNAL HELP', priority: 4 };
        const labels = new Set(getCapabilityLabels(worker));
        if (labels.has('COORD')) return { id: 'coordinators', label: 'COORDINATORS', priority: 0 };
        if (labels.has('OA')) return { id: 'order-auditors', label: 'ORDER AUDITORS', priority: 1 };
        if (labels.has('FLT')) return { id: 'forklift-drivers', label: 'FORKLIFT DRIVERS', priority: 2 };
        return { id: 'order-pickers', label: 'ORDER PICKERS', priority: 3 };
    }

    function groupUnassignedWorkers(workers) {
        const definitions = [
            { id: 'coordinators', label: 'COORDINATORS', priority: 0 },
            { id: 'order-auditors', label: 'ORDER AUDITORS', priority: 1 },
            { id: 'forklift-drivers', label: 'FORKLIFT DRIVERS', priority: 2 },
            { id: 'order-pickers', label: 'ORDER PICKERS', priority: 3 },
            { id: 'external-help', label: 'EXTERNAL HELP', priority: 4 }
        ];
        const groups = new Map(definitions.map(group => [group.id, { ...group, workers: [] }]));
        workers.forEach(worker => groups.get(getUnassignedRoleGroup(worker).id).workers.push(worker));
        return definitions
            .map(group => groups.get(group.id))
            .filter(group => group.workers.length)
            .map(group => ({ ...group, workers: sortWorkersByStart(group.workers) }));
    }

    function localDateObject(dateString) {
        const [y, m, d] = dateString.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function formatDate(value) {
        return localDateObject(getDateKey(value)).toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    function formatShortDate(dateString) {
        return localDateObject(dateString).toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short'
        });
    }

    function formatGeneratedTime() {
        return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    // ---------- Response normalization ----------

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

    // ---------- Colors / functions / badges ----------

    function timePlanColorToHex(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '#666666';
        const blue = (number >> 16) & 255;
        const green = (number >> 8) & 255;
        const red = number & 255;
        return ('#' + red.toString(16).padStart(2, '0') + green.toString(16).padStart(2, '0') + blue.toString(16).padStart(2, '0')).toUpperCase();
    }

    function normalizeHexColor(hex) {
        let clean = String(hex || '').replace('#', '').trim();
        if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
        return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean.toUpperCase()}` : '#666666';
    }

    function getContrastTextColor(color) {
        const hex = normalizeHexColor(color).substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return ((r * 299 + g * 587 + b * 114) / 1000) > 155 ? '#222222' : '#FFFFFF';
    }

    function buildFunctionMap(json) {
        const map = {};
        const functions = json?.LoadSetting?.[0]?.jobFunctions || [];
        functions.forEach(fn => {
            if (fn?.id === undefined || fn?.name === undefined) return;
            map[String(fn.id)] = { name: fn.name || '', color: timePlanColorToHex(fn.color) };
        });
        return map;
    }

    function getSpecialFunctionBadge(name) {
        const text = String(name || '').trim().toLowerCase();
        if (text.includes('forklift')) return { label: 'FLT', color: '#E0A800' };
        if (text.includes('order auditor') || text.includes('order audit')) return { label: 'OA', color: '#222222' };
        if (text.includes('coordinator')) return { label: 'COORD', color: TP_BLUE };
        if (text.includes('order picking delivery')) return { label: 'OPD', color: null };
        if (text.includes('order picking other')) return { label: 'OPO', color: null };
        return null;
    }

    function abbreviateFunctionName(name) {
        const words = String(name || '').replace(/[^A-Za-z0-9\u00C6\u00D8\u00C5\u00E6\u00F8\u00E5]+/g, ' ').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return 'FUNC';
        if (words.length === 1) return words[0].substring(0, 4).toUpperCase();
        return words.map(w => w.charAt(0)).join('').substring(0, 5).toUpperCase();
    }

    function getFunctionBadges(worker) {
        const map = new Map();
        (worker.functionSegments || []).forEach(segment => {
            const name = String(segment.name || '').trim();
            if (!name) return;
            const key = segment.id !== undefined ? `id:${segment.id}` : `name:${name.toLowerCase()}`;
            if (map.has(key)) return;
            const special = getSpecialFunctionBadge(name);
            map.set(key, {
                label: special?.label || abbreviateFunctionName(name),
                title: name,
                color: normalizeHexColor(special?.color || segment.color || '#666666')
            });
        });

        // Oplæring is useful operational information even though it is not an
        // absence. Show it as a temporary capability-style badge for this day.
        if (worker.training) {
            map.set('status:training', {
                label: 'TRAINING',
                title: 'Oplæring / Training',
                color: '#7A5AF8'
            });
        }

        return Array.from(map.values());
    }

    function getCapabilityLabels(worker) { return getFunctionBadges(worker).map(b => b.label); }
    function getFunctionNames(worker) {
        return Array.from(new Set((worker.functionSegments || []).map(s => String(s.name || '').trim()).filter(Boolean)));
    }

    function getFunctionBadgeStyle(badge, compact = false) {
        const background = normalizeHexColor(badge.color);
        return `display:inline-flex;align-items:center;justify-content:center;height:${compact ? '16px' : '19px'};padding:0 ${compact ? '4px' : '6px'};border:1px solid ${background};border-radius:999px;background:${background};color:${getContrastTextColor(background)};font-size:${compact ? '7px' : '9px'};line-height:1;font-weight:800;white-space:nowrap;letter-spacing:.2px;`;
    }

    function renderCapabilityBadges(worker, compact = false) {
        const badges = getFunctionBadges(worker);
        if (!badges.length) return '';
        return `<span style="display:inline-flex;flex-wrap:wrap;gap:${compact ? '2px' : '3px'};align-items:center;">${badges.map(badge => `<span title="${escapeHTML(badge.title)}" style="${getFunctionBadgeStyle(badge, compact)}">${escapeHTML(badge.label)}</span>`).join('')}</span>`;
    }

    // New in v1.10: function-color vertical bar.
    // Multiple function segments are represented proportionally from top to bottom.
    function getFunctionBarBackground(worker) {
        const segments = (worker.functionSegments || []).filter(s => s?.start && s?.end);
        if (!segments.length) return '#9A9A9A';
        if (segments.length === 1) return normalizeHexColor(segments[0].color || '#666666');

        const durations = segments.map(s => minutesBetween(s.start, s.end));
        const total = durations.reduce((sum, value) => sum + value, 0);
        if (!total) return normalizeHexColor(segments[0].color || '#666666');

        let cursor = 0;
        const stops = [];
        segments.forEach((segment, index) => {
            const startPct = cursor / total * 100;
            cursor += durations[index];
            const endPct = cursor / total * 100;
            const color = normalizeHexColor(segment.color || '#666666');
            stops.push(`${color} ${startPct.toFixed(2)}%`, `${color} ${endPct.toFixed(2)}%`);
        });
        return `linear-gradient(to bottom, ${stops.join(', ')})`;
    }

    // ---------- Worktime merge ----------

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

    // ---------- Absence / effective presence ----------

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

    function buildUnavailableAbsences(absences) {
        return absences.filter(absence =>
            absence.physicallyPresent === false &&
            absence.employeeid !== undefined &&
            absence.from && absence.to &&
            !isTrainingActivity(absence)
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

    function buildDays(employees, absences, functionMap, trainingActivities = []) {
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
                if (relevantAbsences.some(absence => absence.allDay)) return;

                (days[date] ||= []).push({
                    name: employee.employee_name || 'Unknown',
                    employeeId: employee.employee_id,
                    start: worktime.start_time,
                    end: worktime.end_time,
                    effectiveStart: effectiveBlocks[0].start_time,
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

    // ---------- HTML utils ----------

    function escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function safeJSONStringify(value) {
        return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    }

    function getUniqueCoworkerCount(workers) {
        return new Set(workers.map(worker => String(worker.employeeId))).size;
    }

    // ---------- Sorted View ----------

    function renderFunctionBadges(worker) {
        const segments = worker.functionSegments || [];
        if (!segments.length) return `<span style="color:#777;font-size:12px;font-weight:600;">No function</span>`;
        const multiple = segments.length > 1;
        return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${segments.map(segment => {
            const color = normalizeHexColor(segment.color);
            return `<div style="display:inline-flex;align-items:stretch;min-height:29px;background:#F7F7F7;border:1px solid #D8D8D8;border-radius:6px;overflow:hidden;white-space:nowrap;box-shadow:0 1px 1px rgba(0,0,0,.03);"><span style="width:5px;min-width:5px;background:${color};"></span><span style="display:inline-flex;align-items:center;gap:7px;padding:4px 9px 4px 8px;"><span style="color:#272727;font-size:12px;font-weight:700;">${escapeHTML(segment.name)}</span>${multiple ? `<span style="color:#777;font-size:11px;font-weight:600;">${formatTime(segment.start)}&ndash;${formatTime(segment.end)}</span>` : ''}</span></div>`;
        }).join('')}</div>`;
    }

    function renderAbsenceIndicator(worker, compact = false) {
        const segments = worker.absenceSegments || [];
        if (!segments.length) return '';

        const marginTop = compact ? '3px' : '4px';
        const labelSize = compact ? '9px' : '10px';
        const timeSize = compact ? '10px' : '11px';
        const padding = compact ? '2px 5px' : '2px 6px';

        return `<div style="display:flex;flex-wrap:wrap;gap:${compact ? '4px' : '6px'};align-items:center;margin-top:${marginTop};">${segments.map(segment => `
            <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
                <span style="display:inline-flex;align-items:center;justify-content:center;padding:${padding};border:1px solid #C85B52;border-radius:4px;background:#FFF8F7;color:#9E2F28;font-size:${labelSize};font-weight:900;letter-spacing:.25px;line-height:1.2;">ABS</span>
                <span style="color:#8A4B47;font-size:${timeSize};font-weight:750;line-height:1.2;">${formatTime(segment.start)}&ndash;${formatTime(segment.end)}</span>
            </span>`).join('')}</div>`;
    }

    // Sorted View rendering and PDF export live in src/sorted-view/sorted-view.js.
    // Shared rendering helpers above remain available to other features.

    // ---------- Board state ----------

    function getWorkerKey(worker) { return worker.key || [worker.employeeId, worker.start, worker.end].join('|'); }
    function getAssignmentsForSelectedDate() { return (boardAssignments[selectedDate] ||= {}); }
    function getNotPresentForSelectedDate() { return (notPresentByDate[selectedDate] ||= {}); }
    function getExternalWorkersForSelectedDate() { return (externalWorkersByDate[selectedDate] ||= []); }
    function getBoardWorkersForSelectedDate() { return [...(currentDays[selectedDate] || []), ...getExternalWorkersForSelectedDate()]; }
    function getWorkerAssignment(worker) { return getAssignmentsForSelectedDate()[getWorkerKey(worker)] || 'unassigned'; }
    function assignWorker(key, area) { getAssignmentsForSelectedDate()[key] = area; }

    function setWorkerNotPresent(worker, value) {
        const key = getWorkerKey(worker);
        if (value) {
            getNotPresentForSelectedDate()[key] = true;
            assignWorker(key, 'unassigned');
        } else {
            delete getNotPresentForSelectedDate()[key];
        }
        renderPanel();
    }

    function makeExternalTimestamp(time) {
        return `${selectedDate}T${time}:00.000Z`;
    }

    function isValidClock(value) {
        return /^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(String(value || '').trim());
    }

    function addExternalHelp() {
        const name = prompt('External coworker name:');
        if (!name || !name.trim()) return;
        const start = prompt('Shift start (HH:MM):', '08:00');
        if (!isValidClock(start)) return alert('Please use HH:MM, for example 08:00.');
        const end = prompt('Shift end (HH:MM):', '16:00');
        if (!isValidClock(end)) return alert('Please use HH:MM, for example 16:00.');
        if (timeToMinutes(makeExternalTimestamp(end)) <= timeToMinutes(makeExternalTimestamp(start))) return alert('End time must be later than start time.');

        const id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const worker = {
            key: `external|${id}`,
            externalId: id,
            isExternal: true,
            employeeId: 'EXT',
            name: name.trim(),
            start: makeExternalTimestamp(start),
            end: makeExternalTimestamp(end),
            effectiveStart: makeExternalTimestamp(start),
            absenceSegments: [],
            functionSegments: []
        };
        getExternalWorkersForSelectedDate().push(worker);
        assignWorker(worker.key, 'unassigned');
        unassignedCollapsedByDate[selectedDate] = false;
        renderPanel();
    }

    function editExternalHelp(worker) {
        if (!worker?.isExternal) return;
        const name = prompt('External coworker name:', worker.name);
        if (!name || !name.trim()) return;
        const start = prompt('Shift start (HH:MM):', formatTime(worker.start));
        if (!isValidClock(start)) return alert('Please use HH:MM, for example 08:00.');
        const end = prompt('Shift end (HH:MM):', formatTime(worker.end));
        if (!isValidClock(end)) return alert('Please use HH:MM, for example 16:00.');
        if (timeToMinutes(makeExternalTimestamp(end)) <= timeToMinutes(makeExternalTimestamp(start))) return alert('End time must be later than start time.');
        worker.name = name.trim();
        worker.start = makeExternalTimestamp(start);
        worker.end = makeExternalTimestamp(end);
        worker.effectiveStart = makeExternalTimestamp(start);
        renderPanel();
    }

    function removeExternalHelp(worker) {
        if (!worker?.isExternal) return;
        if (!confirm(`Remove external coworker ${worker.name}?`)) return;
        const list = getExternalWorkersForSelectedDate();
        const index = list.findIndex(item => getWorkerKey(item) === getWorkerKey(worker));
        if (index >= 0) list.splice(index, 1);
        delete getAssignmentsForSelectedDate()[getWorkerKey(worker)];
        delete getNotPresentForSelectedDate()[getWorkerKey(worker)];
        renderPanel();
    }

    function resetBoard() {
        boardAssignments[selectedDate] = {};
        notPresentByDate[selectedDate] = {};
        externalWorkersByDate[selectedDate] = [];
        unassignedCollapsedByDate[selectedDate] = false;
        renderPanel();
    }

    function buildWorkersByArea(workers) {
        const result = { unassigned: [], leadership: [] };
        BOARD_AREAS.forEach(group => group.areas.forEach(area => result[area.id] = []));
        workers.forEach(worker => (result[getWorkerAssignment(worker)] || result.unassigned).push(worker));
        Object.keys(result).forEach(area => result[area] = sortWorkersByStart(result[area]));
        return result;
    }

    function findAreaInfo(areaId) {
        if (areaId === 'leadership') return { flow: 'Leadership', area: 'Order Auditor - Coordinator' };
        if (areaId === 'unassigned') return { flow: 'Unassigned', area: 'Unassigned' };
        for (const group of BOARD_AREAS) {
            const area = group.areas.find(item => item.id === areaId);
            if (area) return { flow: group.group, area: area.name };
        }
        return { flow: 'Unassigned', area: 'Unassigned' };
    }


    // ---------- Basic Plan templates ----------

    // Create Basic Plan logic now lives in src/interactive-board/interactive-board.js.
    // Pass the existing app helpers to preserve the exact assignment behavior.
    const basicPlan = window.TimePlanInteractiveBoard.createBasicPlan({
        timeToMinutes, getWorkerEffectiveStart, getFunctionBadges,
        getFunctionNames, getBoardWorkersForSelectedDate,
        isWorkerNotPresent, getWorkerAssignment, sortWorkersByStart,
        getUnassignedRoleGroup, BOARD_AREAS, assignWorker, getWorkerKey,
        onCompleted: (collapseUnassigned) => {
            if (collapseUnassigned) unassignedCollapsedByDate[selectedDate] = true;
            renderPanel();
        }
    });
    const applyBasicPlan = basicPlan.applyBasicPlan;

    function createBasicPlanMenu() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-block;';

        const button = document.createElement('button');
        button.textContent = 'Create Basic Plan';
        button.style.cssText = `font-family:${TOOL_FONT};background:white;border:1px solid ${TP_BLUE};color:${TP_BLUE};border-radius:7px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;`;

        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:245px;background:white;border:1px solid #ccc;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000;';

        [
            ['Morning Default', 'Morning team only - Unassigned coworkers', () => applyBasicPlan('morning')],
            ['Evening Default', 'Evening team only - Unassigned coworkers', () => applyBasicPlan('evening')]
        ].forEach(([label, description, action], index) => {
            const item = document.createElement('button');
            item.style.cssText = `display:block;width:100%;font-family:${TOOL_FONT};text-align:left;border:none;border-top:${index ? '1px solid #eee' : 'none'};background:white;padding:10px 13px;color:#222;cursor:pointer;`;
            item.innerHTML = `<div style="font-size:13px;font-weight:800;">${escapeHTML(label)}</div><div style="margin-top:2px;font-size:10px;font-weight:600;color:#777;">${escapeHTML(description)}</div>`;
            item.onmouseenter = () => item.style.background = '#f4f4f4';
            item.onmouseleave = () => item.style.background = '#fff';
            item.onclick = () => {
                menu.style.display = 'none';
                action();
            };
            menu.appendChild(item);
        });

        button.onclick = event => {
            event.stopPropagation();
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        };
        menu.onclick = event => event.stopPropagation();
        document.addEventListener('click', () => menu.style.display = 'none');

        wrapper.append(button, menu);
        return wrapper;
    }

    // ---------- Board magnets ----------

    function createWorkerMagnet(worker) {
        const magnet = document.createElement('div');
        const key = getWorkerKey(worker);
        const notPresent = isWorkerNotPresent(worker);
        const barBackground = worker.isExternal ? '#777777' : getFunctionBarBackground(worker);
        magnet.draggable = !notPresent;
        magnet.style.cssText = `position:relative;overflow:visible;font-family:${TOOL_FONT};background:${notPresent ? '#F1F1F1' : '#fff'};border:1px solid ${notPresent ? '#BDBDBD' : '#c8c8c8'};border-radius:7px;padding:8px 10px 8px 14px;margin:4px;min-width:145px;max-width:235px;box-shadow:0 2px 5px rgba(0,0,0,.12);cursor:${notPresent ? 'pointer' : 'grab'};user-select:none;opacity:${notPresent ? '.52' : '1'};`;
        magnet.innerHTML = `
            <span style="position:absolute;left:0;top:0;bottom:0;width:5px;background:${notPresent ? '#9A9A9A' : barBackground};border-radius:7px 0 0 7px;"></span>
            <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:14px;font-weight:800;"><span>${escapeHTML(worker.name)}</span>${worker.isExternal ? '<span style="display:inline-flex;align-items:center;height:19px;padding:0 6px;border-radius:999px;background:#666;color:#fff;font-size:9px;font-weight:900;">EXT</span>' : renderCapabilityBadges(worker)}${notPresent ? '<span style="display:inline-flex;align-items:center;height:19px;padding:0 6px;border-radius:999px;background:#666;color:#fff;font-size:9px;font-weight:900;">ABSENCE</span>' : ''}</div>
            <div style="margin-top:4px;font-size:12px;"><span style="font-weight:900;color:#222;">${formatTime(worker.start)}</span><span style="font-weight:700;color:#999;"> &rarr; </span><span style="font-weight:700;color:#666;">${formatTime(worker.end)}</span></div>
            ${worker.isExternal ? '<div style="margin-top:3px;color:#777;font-size:10px;font-weight:700;">External help</div>' : renderAbsenceIndicator(worker, true)}`;

        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;left:8px;top:calc(100% + 4px);z-index:100000;min-width:165px;background:white;border:1px solid #bbb;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;opacity:1;';
        const actionButton = (label, handler, danger = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = `display:block;width:100%;font-family:${TOOL_FONT};text-align:left;border:none;border-top:${menu.children.length ? '1px solid #eee' : 'none'};background:white;padding:9px 11px;color:${danger ? '#A12622' : '#222'};font-size:11px;font-weight:800;cursor:pointer;`;
            button.onclick = event => { event.stopPropagation(); menu.style.display = 'none'; handler(); };
            menu.appendChild(button);
        };
        actionButton(notPresent ? 'Mark as available' : 'Mark as absent', () => setWorkerNotPresent(worker, !notPresent));
        if (worker.isExternal) {
            actionButton('Edit external help', () => editExternalHelp(worker));
            actionButton('Remove external help', () => removeExternalHelp(worker), true);
        }
        magnet.appendChild(menu);

        magnet.addEventListener('click', event => {
            if (event.defaultPrevented) return;
            event.stopPropagation();
            document.querySelectorAll('[data-tp-magnet-menu="1"]').forEach(other => { if (other !== menu) other.style.display = 'none'; });
            menu.dataset.tpMagnetMenu = '1';
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });

        if (!notPresent) {
            magnet.addEventListener('dragstart', event => {
                draggedWorkerKey = key;
                event.dataTransfer.setData('text/plain', key);
                magnet.style.opacity = '.45';
            });
            magnet.addEventListener('dragend', () => {
                draggedWorkerKey = null;
                magnet.style.opacity = '1';
            });
        }
        return magnet;
    }

    function createDropZone(areaId, areaName, workers) {
        const zone = document.createElement('div');
        const leadership = areaId === 'leadership';
        const unassigned = areaId === 'unassigned';
        const compactEmpty = !unassigned && !workers.length;
        zone.style.cssText = `min-height:${compactEmpty ? '46px' : unassigned ? '80px' : leadership ? '75px' : '105px'};border:${leadership ? `2px solid ${TP_BLUE}` : `2px dashed ${unassigned ? '#aaa' : '#c5c5c5'}`};border-radius:8px;background:${leadership ? TP_LIGHT_BLUE : unassigned ? '#fafafa' : '#f8f8f8'};padding:${compactEmpty ? '8px 9px' : '9px'};transition:min-height .16s ease,background .16s ease,border-color .16s ease;`;

        const header = document.createElement('div');
        header.style.cssText = `display:flex;justify-content:space-between;align-items:center;margin-bottom:${compactEmpty ? '0' : '7px'};font-size:13px;font-weight:800;gap:8px;`;
        header.innerHTML = `<span>${escapeHTML(areaName)}</span>${compactEmpty ? '<span style="margin-left:auto;color:#999;font-size:10px;font-weight:800;">Drop here</span>' : ''}<span style="display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:23px;padding:0 6px;border-radius:999px;background:${leadership ? TP_BLUE : '#e6e6e6'};color:${leadership ? '#fff' : '#333'};font-size:12px;">${workers.length}</span>`;
        zone.appendChild(header);

        const container = document.createElement('div');
        container.style.cssText = `display:${compactEmpty ? 'none' : 'flex'};flex-wrap:wrap;min-height:${compactEmpty ? '0' : '45px'};`;

        if (unassigned) {
            groupUnassignedWorkers(workers).forEach((group, groupIndex) => {
                const divider = document.createElement('div');
                divider.style.cssText = `flex-basis:100%;display:flex;align-items:center;gap:8px;margin:${groupIndex ? '9px' : '3px'} 3px 3px;color:#666;font-size:9px;font-weight:900;letter-spacing:.45px;text-transform:uppercase;`;
                divider.innerHTML = `<span style="flex:1;height:1px;background:#D4D4D4;"></span><span>${escapeHTML(group.label)} &middot; ${group.workers.length}</span><span style="flex:1;height:1px;background:#D4D4D4;"></span>`;
                container.appendChild(divider);
                group.workers.forEach(worker => container.appendChild(createWorkerMagnet(worker)));
            });
        } else {
            let eveningDividerAdded = false;
            sortWorkersByStart(workers).forEach(worker => {
                const effectiveStartTime = formatTime(getWorkerEffectiveStart(worker));
                const [hour, minute] = effectiveStartTime.split(':').map(Number);
                const startMinutes = (hour * 60) + minute;
                const isEveningTeam = startMinutes >= (11 * 60);
                if (!eveningDividerAdded && isEveningTeam) {
                    const divider = document.createElement('div');
                    divider.style.cssText = 'flex-basis:100%;display:flex;align-items:center;gap:8px;margin:7px 3px 3px;color:#777;font-size:9px;font-weight:900;letter-spacing:.45px;text-transform:uppercase;';
                    divider.innerHTML = '<span style="flex:1;height:1px;background:#D4D4D4;"></span><span>Evening Team</span><span style="flex:1;height:1px;background:#D4D4D4;"></span>';
                    container.appendChild(divider);
                    eveningDividerAdded = true;
                }
                container.appendChild(createWorkerMagnet(worker));
            });
        }
        if (!workers.length && !compactEmpty) container.innerHTML = '<div style="width:100%;text-align:center;padding:14px 5px;color:#999;font-size:12px;font-weight:700;">Drop here</div>';
        zone.appendChild(container);

        zone.addEventListener('dragover', event => {
            event.preventDefault();
            zone.style.borderColor = TP_BLUE;
            zone.style.background = 'rgba(0,88,163,.10)';
            if (compactEmpty) {
                zone.style.minHeight = '82px';
                container.style.display = 'flex';
                container.style.minHeight = '32px';
                container.innerHTML = '<div style="width:100%;text-align:center;padding:8px 5px;color:#6A6A6A;font-size:11px;font-weight:800;">Drop here</div>';
            }
        });
        zone.addEventListener('dragleave', event => {
            if (zone.contains(event.relatedTarget)) return;
            if (compactEmpty) {
                zone.style.minHeight = '46px';
                zone.style.background = '#f8f8f8';
                zone.style.borderColor = '#c5c5c5';
                container.style.display = 'none';
                container.style.minHeight = '0';
            }
        });
        zone.addEventListener('drop', event => {
            event.preventDefault();
            const key = event.dataTransfer.getData('text/plain') || draggedWorkerKey;
            if (!key) return;
            assignWorker(key, areaId);
            renderPanel();
        });
        return zone;
    }

    // ---------- Headers / tabs ----------

    function renderDayButtons(panel) {
        const selector = document.createElement('div');
        selector.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:15px 0;padding-bottom:14px;border-bottom:2px solid #ddd;';
        Object.keys(currentDays).sort().forEach(date => {
            const button = document.createElement('button');
            const selected = date === selectedDate;
            button.textContent = formatShortDate(date);
            button.style.cssText = `font-family:${TOOL_FONT};border:1px solid ${selected ? TP_BLUE : '#ccc'};background:${selected ? TP_BLUE : '#f3f3f3'};color:${selected ? '#fff' : '#222'};border-radius:6px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;`;
            button.onclick = () => { selectedDate = date; renderPanel(); };
            selector.appendChild(button);
        });
        panel.appendChild(selector);
    }

    function renderViewTabs(panel) {
        // TimePlan Tools now has one embedded data view (Sorted View).
        // Board Planning is the operational Interactive Board, so the second
        // control acts as a launcher instead of rendering a duplicate board.
        activeView = 'sorted';

        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;gap:8px;margin-bottom:18px;';

        const sortedButton = document.createElement('button');
        sortedButton.textContent = 'Sorted View';
        sortedButton.style.cssText = `font-family:${TOOL_FONT};border:2px solid ${TP_BLUE};background:${TP_BLUE};color:#fff;padding:9px 16px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;`;
        sortedButton.onclick = () => { activeView = 'sorted'; renderPanel(); };
        tabs.appendChild(sortedButton);

        const boardAllowed = isBoardDepartment();
        const boardButton = document.createElement('button');
        boardButton.textContent = boardAllowed ? 'Go to Board Planning' : '🔒 Go to Board Planning';
        boardButton.title = boardAllowed
            ? 'Open the operational Interactive Board for the selected day'
            : '🔒 Interactive Board is currently available only for 094-4050 Full Serve.';
        boardButton.disabled = !boardAllowed;
        boardButton.setAttribute('aria-disabled', String(!boardAllowed));
        boardButton.style.cssText = boardAllowed
            ? `font-family:${TOOL_FONT};border:2px solid ${TP_BLUE};background:#fff;color:${TP_BLUE};padding:9px 16px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;`
            : `font-family:${TOOL_FONT};border:2px solid #CCC;background:#F2F2F2;color:#888;padding:9px 16px;border-radius:7px;font-size:14px;font-weight:700;cursor:not-allowed;opacity:.8;`;
        if (boardAllowed) {
            boardButton.onclick = async () => {
                boardButton.disabled = true;
                const originalText = boardButton.textContent;
                boardButton.textContent = 'Opening Board...';
                try {
                    await openInteractiveBoard();
                } finally {
                    boardButton.disabled = false;
                    boardButton.textContent = originalText;
                }
            };
        }
        tabs.appendChild(boardButton);

        panel.appendChild(tabs);
    }

    function renderDayHeader(panel, workers) {
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;';
        header.innerHTML = `<div style="font-size:20px;font-weight:800;">${escapeHTML(formatDate(workers[0].start))}</div><div style="padding:5px 10px;background:#f2f2f2;border-radius:7px;font-size:13px;font-weight:700;color:#555;">${getUniqueCoworkerCount(workers)} coworkers</div>`;
        panel.appendChild(header);
    }

    // ---------- Interactive HTML ----------

    // Export snapshot preparation lives in the Interactive Board module.
    // The complete standalone HTML template remains unchanged in this file.
    const exportData = window.TimePlanInteractiveBoard.createExportData({
        getBoardWorkersForSelectedDate,
        getSelectedDate: () => selectedDate,
        getSnapshotCapturedAt: () => snapshotCapturedAt,
        getNativeTimePlanFontFamily, collectPortableTimePlanFontFaceCSS,
        collectTimePlanFontFaceCSS, getTimePlanStylesheetLinksHTML,
        formatDate, formatTime, sortWorkersByStart, getWorkerKey,
        getWorkerEffectiveStart, getFunctionBadges, getFunctionNames,
        getFunctionBarBackground, getAssignmentsForSelectedDate,
        getNotPresentForSelectedDate, BOARD_DEPARTMENT_CODE, BOARD_AREAS
    });
    const getInteractiveExportData = exportData.getInteractiveExportData;

    // Standalone handover HTML generator now lives in the Interactive Board module.
    // Its embedded CSS/JS is unchanged and stays self-contained for downloaded files.
    const standaloneHTML = window.TimePlanInteractiveBoard.createStandaloneHTML({
        getInteractiveExportData, safeJSONStringify, escapeHTML,
        escapeStyleClose, TOOL_FONT, TP_BLUE, TP_LIGHT_BLUE
    });
    const buildInteractiveBoardHTML = standaloneHTML.buildInteractiveBoardHTML;

    async function openInteractiveBoard() {
        if (!isBoardDepartment()) return;
        const newWindow = window.open('', '_blank', 'width=1500,height=950');
        if (!newWindow) return alert('The browser blocked the new tab/window.');
        newWindow.document.write('<p style="font-family:Arial;padding:24px">Preparing portable Interactive Board...</p>');
        const html = await buildInteractiveBoardHTML();
        newWindow.document.open();
        newWindow.document.write(html);
        newWindow.document.close();
        // Give this generated board a real reloadable URL. On refresh, index.html
        // restores the last board HTML saved in this tab's sessionStorage.
        const boardId = 'tp-board-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const recoveryKey = 'timeplan-tools-board-recovery-' + boardId;
        try {
            newWindow.__tpBoardRecoveryKey = recoveryKey;
            newWindow.sessionStorage.setItem(recoveryKey, html);
            const boardURL = new URL('./index.html', location.href);
            boardURL.searchParams.set('tp_board', boardId);
            newWindow.history.replaceState(null, '', boardURL.href);
        } catch (error) {
            console.warn('Interactive Board reload recovery could not be enabled:', error);
        }
    }

    async function downloadInteractiveHTML() {
        if (!isBoardDepartment()) return;
        const html = await buildInteractiveBoardHTML();
        downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `TimePlan-Interactive-Board-${BOARD_DEPARTMENT_CODE}-${selectedDate}.html`);
    }

    // ---------- Export menu ----------

    function createExportMenu() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-block;';
        const button = document.createElement('button');
        button.textContent = 'Export';
        button.style.cssText = `font-family:${TOOL_FONT};background:${TP_BLUE};border:2px solid ${TP_BLUE};color:white;border-radius:7px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;`;
        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:245px;background:white;border:1px solid #ccc;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000;';

        [
            ['Open Interactive Board', openInteractiveBoard],
            ['Download Interactive HTML', downloadInteractiveHTML],
            ['Export as PDF', exportBoardToPDF],
            ['Export as CSV', exportBoardToCSV]
        ].forEach(([label, action], index) => {
            const item = document.createElement('button');
            item.textContent = label;
            item.style.cssText = `display:block;width:100%;font-family:${TOOL_FONT};text-align:left;border:none;border-top:${index ? '1px solid #eee' : 'none'};background:white;padding:11px 13px;color:#222;font-size:13px;font-weight:700;cursor:pointer;`;
            item.onmouseenter = () => item.style.background = '#f4f4f4';
            item.onmouseleave = () => item.style.background = '#fff';
            item.onclick = () => { menu.style.display = 'none'; action(); };
            menu.appendChild(item);
        });

        button.onclick = event => {
            event.stopPropagation();
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        };
        menu.onclick = event => event.stopPropagation();
        document.addEventListener('click', () => menu.style.display = 'none');
        wrapper.append(button, menu);
        return wrapper;
    }

    // ---------- Board Planning ----------

    function renderBoardPlanning(panel) {
        if (!isBoardDepartment()) { activeView = 'sorted'; return renderPanel(); }

        // Required for the Unassigned area to remain sticky against the viewport.
        // The Board already becomes one column on narrower screens.
        panel.style.overflow = 'visible';

        const workers = currentDays[selectedDate];
        if (!workers?.length) return;
        renderDayHeader(panel, workers);
        const byArea = buildWorkersByArea(workers);

        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;';
        toolbar.innerHTML = `<div><div style="font-size:18px;font-weight:800;">Daily Board Planning</div><div style="font-size:12px;color:#777;margin-top:3px;">Department ${BOARD_DEPARTMENT_CODE}</div></div>`;
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;';
        actions.appendChild(createBasicPlanMenu());
        const externalHelp = document.createElement('button');
        externalHelp.textContent = '+ External Help';
        externalHelp.style.cssText = `font-family:${TOOL_FONT};background:white;border:1px solid #777;color:#333;border-radius:7px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;`;
        externalHelp.onclick = addExternalHelp;
        actions.appendChild(externalHelp);
        actions.appendChild(createExportMenu());
        const reset = document.createElement('button');
        reset.textContent = 'Reset Board';
        reset.style.cssText = `font-family:${TOOL_FONT};background:white;border:1px solid #999;color:#444;border-radius:7px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;`;
        reset.onclick = () => { if (confirm('Reset assignments, not-present marks and external help?')) resetBoard(); };
        actions.appendChild(reset);
        toolbar.appendChild(actions);
        panel.appendChild(toolbar);

        const unassigned = document.createElement('div');
        unassigned.id = 'tp-sticky-unassigned';

        const hasPendingUnassigned = byArea.unassigned.length > 0;
        if (!hasPendingUnassigned) unassignedCollapsedByDate[selectedDate] = true;
        const unassignedCollapsed = unassignedCollapsedByDate[selectedDate] === true;

        unassigned.style.cssText = `
            position:sticky;
            top:8px;
            z-index:60;
            margin-bottom:14px;
            padding:4px 0;
            background:white;
            border-radius:9px;
            box-shadow:0 8px 16px -15px rgba(0,0,0,.65);
            max-height:${unassignedCollapsed ? 'none' : '38vh'};
            overflow-y:${unassignedCollapsed ? 'visible' : 'auto'};
            overscroll-behavior:contain;
        `;

        if (unassignedCollapsed) {
            const compact = document.createElement('div');
            compact.dataset.areaId = 'unassigned';
            compact.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border:2px dashed #aaa;border-radius:8px;background:#fafafa;font-size:13px;font-weight:800;';
            compact.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span>UNASSIGNED</span><span style="display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:23px;padding:0 6px;border-radius:999px;background:#e6e6e6;color:#333;font-size:12px;">${byArea.unassigned.length}</span><span style="color:#777;font-size:11px;font-weight:700;">${byArea.unassigned.length === 1 ? '1 remaining' : `${byArea.unassigned.length} remaining`}</span></div>`;
            const showButton = document.createElement('button');
            showButton.textContent = 'Show';
            showButton.style.cssText = `font-family:${TOOL_FONT};background:white;border:1px solid #aaa;color:#444;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer;`;
            showButton.onclick = event => { event.stopPropagation(); unassignedCollapsedByDate[selectedDate] = false; renderPanel(); };
            compact.appendChild(showButton);
            compact.addEventListener('dragover', event => { event.preventDefault(); compact.style.borderColor = TP_BLUE; compact.style.background = 'rgba(0,88,163,.10)'; });
            compact.addEventListener('dragleave', () => { compact.style.borderColor = '#aaa'; compact.style.background = '#fafafa'; });
            compact.addEventListener('drop', event => {
                event.preventDefault();
                const key = event.dataTransfer.getData('text/plain') || draggedWorkerKey;
                if (!key) return;
                assignWorker(key, 'unassigned');
                renderPanel();
            });
            unassigned.appendChild(compact);
        } else {
            const unassignedZone = createDropZone('unassigned', 'UNASSIGNED', byArea.unassigned);
            const zoneHeader = unassignedZone.firstElementChild;
            if (zoneHeader) {
                const hideButton = document.createElement('button');
                hideButton.textContent = 'Hide';
                hideButton.style.cssText = `font-family:${TOOL_FONT};margin-left:auto;margin-right:7px;background:white;border:1px solid #aaa;color:#444;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:800;cursor:pointer;`;
                hideButton.onclick = event => { event.stopPropagation(); unassignedCollapsedByDate[selectedDate] = true; renderPanel(); };
                zoneHeader.insertBefore(hideButton, zoneHeader.lastElementChild);
            }
            unassigned.appendChild(unassignedZone);
        }
        panel.appendChild(unassigned);

        const leadership = document.createElement('div');
        leadership.style.marginBottom = '18px';
        leadership.appendChild(createDropZone('leadership', 'ORDER AUDITOR - COORDINATOR', byArea.leadership));
        panel.appendChild(leadership);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(300px,1fr));gap:14px;align-items:start;--tp-flow-sticky-top:8px;';

        const updateFlowStickyTop = () => {
            const top = Math.ceil(unassigned.getBoundingClientRect().height) + 16;
            grid.style.setProperty('--tp-flow-sticky-top', `${top}px`);
        };

        BOARD_AREAS.forEach(group => {
            const column = document.createElement('div');
            column.style.cssText = 'border:1px solid #d5d5d5;border-radius:9px;background:#fff;overflow:visible;';
            const count = group.areas.reduce((total, area) => total + byArea[area.id].filter(worker => !isWorkerNotPresent(worker)).length, 0);
            column.innerHTML = `<div style="position:sticky;top:var(--tp-flow-sticky-top,8px);z-index:45;display:flex;justify-content:space-between;align-items:center;padding:12px 13px;background:rgba(0,88,163,.93);color:white;font-size:15px;font-weight:800;border-radius:8px 8px 0 0;box-shadow:0 6px 12px -12px rgba(0,0,0,.8);"><span>${escapeHTML(group.group)}</span><span style="display:inline-flex;align-items:center;justify-content:center;min-width:27px;height:27px;padding:0 7px;border-radius:999px;background:white;color:${TP_BLUE};font-size:12px;">${count}</span></div>`;
            const areaContainer = document.createElement('div');
            areaContainer.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:10px;';
            group.areas.forEach(area => areaContainer.appendChild(createDropZone(area.id, area.name, byArea[area.id])));
            column.appendChild(areaContainer);
            grid.appendChild(column);
        });
        panel.appendChild(grid);
        updateFlowStickyTop();
        requestAnimationFrame(updateFlowStickyTop);
        if (window.innerWidth < 1050) grid.style.gridTemplateColumns = '1fr';
    }

    // ---------- CSV ----------

    function csvEscape(value) {
        const text = String(value ?? '');
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }

    function exportBoardToCSV() {
        const workers = getBoardWorkersForSelectedDate();
        if (!workers?.length) return;
        const headers = ['Date', 'Coworker', 'Employee ID', 'Start', 'End', 'Flow', 'Area', 'Status', 'Badges', 'Functions'];
        const rows = sortWorkersByStart(workers).map(worker => {
            const area = findAreaInfo(getWorkerAssignment(worker));
            return [selectedDate, worker.name, worker.employeeId, formatTime(worker.start), formatTime(worker.end), area.flow, area.area, isWorkerNotPresent(worker) ? 'Not Present' : (worker.isExternal ? 'External Help' : 'Present'), getCapabilityLabels(worker).join('|'), getFunctionNames(worker).join('|')];
        });
        const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
        downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `TimePlan-Board-${BOARD_DEPARTMENT_CODE}-${selectedDate}.csv`);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---------- Main Board PDF ----------

    function renderPDFWorker(worker) {
        return `<div class="worker"><span class="worker-bar" style="background:${getFunctionBarBackground(worker)};"></span><div class="worker-name">${escapeHTML(worker.name)} ${renderCapabilityBadges(worker, true)}</div><div class="worker-time"><strong>${formatTime(worker.start)}</strong><span> &rarr; ${formatTime(worker.end)}</span></div>${renderAbsenceIndicator(worker, true)}</div>`;
    }

    function renderPDFArea(name, workers) {
        return `<div class="area"><div class="area-title"><span>${escapeHTML(name)}</span><span>${workers.length}</span></div><div class="area-workers">${workers.length ? sortWorkersByStart(workers).map(renderPDFWorker).join('') : '-'}</div></div>`;
    }

    function exportBoardToPDF() {
        const workers = currentDays[selectedDate];
        if (!workers?.length) return;
        const byArea = buildWorkersByArea(workers);
        const popup = window.open('', '_blank', 'width=1400,height=900');
        if (!popup) return alert('The browser blocked the print window.');
        const columns = BOARD_AREAS.map(group => `<section class="flow"><div class="flow-header">${escapeHTML(group.group)}</div>${group.areas.map(area => renderPDFArea(area.name, byArea[area.id])).join('')}</section>`).join('');

        popup.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}@page{size:A4 landscape;margin:9mm}body{margin:0;font-family:${TOOL_FONT};color:#222}.header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;margin-bottom:10px;border-bottom:4px solid ${TP_BLUE}}.title{color:${TP_BLUE};font-size:24px;font-weight:800}.date{margin-top:4px;font-size:16px;font-weight:700}.meta{text-align:right;color:#555;font-size:11px}.leadership{margin-bottom:9px}.board{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.flow{border:1px solid #CCC;border-radius:7px;overflow:hidden}.flow-header{padding:8px 10px;background:${TP_BLUE}!important;color:white!important;font-size:14px;font-weight:800}.area{margin:6px;padding:6px;background:#F7F7F7!important;border:1px solid #DDD;border-radius:6px}.area-title{display:flex;justify-content:space-between;margin-bottom:5px;font-size:11px;font-weight:800;text-transform:uppercase}.area-workers{display:flex;flex-wrap:wrap;gap:4px;font-size:10px}.worker{position:relative;overflow:hidden;min-width:110px;max-width:160px;padding:5px 6px 5px 10px;background:white!important;border:1px solid #CCC;border-radius:5px}.worker-bar{position:absolute;left:0;top:0;bottom:0;width:4px}.worker-name{display:flex;flex-wrap:wrap;align-items:center;gap:3px;font-weight:800}.worker-time{margin-top:2px;font-size:9px}.worker-time strong{color:#222;font-weight:900}.worker-time span{color:#666;font-weight:700}
</style></head><body><div class="header"><div><div class="title">DAILY BOARD PLAN</div><div class="date">${escapeHTML(formatDate(workers[0].start))}</div></div><div class="meta">${getUniqueCoworkerCount(workers)} coworkers<br>Department ${BOARD_DEPARTMENT_CODE}<br>Generated ${formatGeneratedTime()}</div></div><div class="leadership">${renderPDFArea('ORDER AUDITOR - COORDINATOR', byArea.leadership)}</div><div class="board">${columns}</div>${byArea.unassigned.length ? renderPDFArea('UNASSIGNED', byArea.unassigned) : ''}</body></html>`);
        popup.document.close();
        setTimeout(() => popup.print(), 400);
    }

    // ---------- Panel ----------

    let snapshotCapturedAt = null;

    function renderPanel() {
        document.getElementById(PANEL_ID)?.remove();
        const dates = Object.keys(currentDays).sort();
        if (!dates.length) return;
        if (!selectedDate || !currentDays[selectedDate]) selectedDate = dates[0];
        activeView = 'sorted';

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `position:relative;margin:18px 24px;padding:20px;background:white;border:2px solid ${TP_BLUE};border-radius:8px;box-shadow:0 3px 14px rgba(0,0,0,.18);font-family:${TOOL_FONT};z-index:9999;color:#222;overflow-x:auto;`;
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        top.innerHTML = `<div><div style="font-size:22px;font-weight:800;color:${TP_BLUE};">TimePlan Tools</div><div style="font-size:13px;color:#666;margin-top:3px;">Department Plan</div></div>`;
        if (snapshotCapturedAt) {
            const stamp = document.createElement('div');
            stamp.style.cssText = 'font-size:12px;color:#666;margin-top:5px;';
            stamp.textContent = 'Snapshot · ' + new Intl.DateTimeFormat('en-GB', {dateStyle:'medium',timeStyle:'short'}).format(snapshotCapturedAt);
            top.firstElementChild.appendChild(stamp);
        }
        panel.appendChild(top);
        renderDayButtons(panel);
        renderViewTabs(panel);
        // Keep TimePlan Tools focused on the roster. The operational board
        // opens in its own Interactive Board tab via Go to Board Planning.
        // Prefer the extracted Sorted View module; keep the original renderer as fallback.
        // The module receives the current date and roster on each render.
        let sortedViewRendered = false;
        const panelChildrenBeforeSortedView = panel.children.length;
        if (typeof window.TimePlanSortedView === 'function') {
            try {
                const sortedViewModule = window.TimePlanSortedView({
                    TP_BLUE, TOOL_FONT, BOARD_DEPARTMENT_CODE,
                    formatTime, formatDate, escapeHTML, getUniqueCoworkerCount,
                    renderDayHeader, sortWorkersByOfficialStart,
                    renderCapabilityBadges, renderFunctionBadges, getFunctionBadges,
                    normalizeHexColor, getContrastTextColor,
                    currentDays, selectedDate
                });
                sortedViewModule.renderSortedView(panel);
                sortedViewRendered = true;
                console.info('[TimePlan Tools] Sorted View source: EXTERNAL MODULE (src/sorted-view/sorted-view.js)');
            } catch (error) {
                console.error('Sorted View module failed.', error);
                // Discard partial rendering before showing an error message.
                while (panel.children.length > panelChildrenBeforeSortedView) panel.lastElementChild.remove();
            }
        }
        if (!sortedViewRendered) {
            console.error('[TimePlan Tools] Sorted View module unavailable or failed.');
            const warning = document.createElement('p');
            warning.style.cssText = 'padding:12px;border:1px solid #C85B52;border-radius:6px;color:#9E2F28;background:#FFF8F7;font-weight:700;';
            warning.textContent = 'Sorted View could not load. Refresh the page or restore the previous app version.';
            panel.appendChild(warning);
        }
        document.body.insertBefore(panel, document.body.firstChild);
        updateButtonState();
    }

    function updateButtonState() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;
        button.textContent = document.getElementById(PANEL_ID) ? 'Close TimePlan Tools' : 'TimePlan Tools';
    }

    async function loadTimePlanTools() {
        const existing = document.getElementById(PANEL_ID);
        if (existing) { existing.remove(); updateButtonState(); return; }
        const button = document.getElementById(BUTTON_ID);
        try {
            button.disabled = true;
            button.textContent = 'Loading...';
            const worktimesUrl = findDepartmentWorktimesUrl();
            if (!worktimesUrl) { alert('Open Department Plan and refresh once.'); return; }
            const [worktimesJSON, absenceJSON, settingsJSON] = await Promise.all([
                getJSON(worktimesUrl),
                getJSON(findDepartmentAbsenceUrl() || buildAbsenceUrl(worktimesUrl)),
                getJSON(findLoadSettingUrl() || buildLoadSettingUrl())
            ]);
            const employees = normalizeWorktimesResponse(worktimesJSON);
            const rawAbsences = normalizeAbsenceResponse(absenceJSON);
            const trainingActivities = rawAbsences.filter(isTrainingActivity);
            const absences = buildUnavailableAbsences(rawAbsences);
            const functionMap = buildFunctionMap(settingsJSON);
            snapshotCapturedAt = new Date();
            currentDays = buildDays(employees, absences, functionMap, trainingActivities);
            const dates = Object.keys(currentDays).sort();
            if (!dates.length) { alert('No scheduled coworkers found.'); return; }
            if (!selectedDate || !currentDays[selectedDate]) selectedDate = dates[0];
            renderPanel();
        } catch (error) {
            console.error(error);
            alert('Could not open TimePlan Tools.\n\n' + error.message);
        } finally {
            button.disabled = false;
            updateButtonState();
        }
    }

    function updateFloatingButton() {
        const existing = document.getElementById(BUTTON_ID);
        if (!isDepartmentPlanPage()) {
            existing?.remove();
            document.getElementById(PANEL_ID)?.remove();
            return;
        }
        if (existing) { updateButtonState(); return; }
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.textContent = 'TimePlan Tools';
        button.style.cssText = `position:fixed;right:24px;bottom:24px;z-index:99999;font-family:${TOOL_FONT};background:${TP_BLUE};color:white;border:none;border-radius:9px;padding:16px 24px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);`;
        button.onclick = loadTimePlanTools;
        document.body.appendChild(button);
    }

    // ---------- GitHub Pages standalone bridge ----------
    const SNAPSHOT_STORAGE_KEY = "timeplan-tools-alpha2-roster-snapshot";
    function saveSnapshot(input) {
        try { sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(input)); }
        catch (error) { console.warn("Snapshot could not be saved for reload:", error); }
    }
    function restoreSnapshot() {
        try {
            const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
            return raw ? loadStandalonePayload(JSON.parse(raw), false) : false;
        } catch (error) {
            console.warn("Saved snapshot could not be restored:", error);
            try { sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY); } catch {}
            return false;
        }
    }
    function setStandaloneStatus(message, isError = false) {
        const el = document.getElementById('tp-loader-status');
        if (!el) return;
        el.textContent = message;
        el.style.color = isError ? '#B42318' : '#555';
    }

    function unwrapPayload(input) {
        const root = input && typeof input === 'object' ? input : {};
        const p = root.payload && typeof root.payload === 'object' ? root.payload : root;
        return {
            worktimes: p.worktimesJSON ?? p.worktimes ?? p.departmentWorktimes ?? p.DepartmentWorktimes ?? p.roster ?? null,
            absences: p.absenceJSON ?? p.absencesJSON ?? p.absence ?? p.absences ?? p.departmentAbsence ?? p.DepartmentAbsence ?? null,
            settings: p.settingsJSON ?? p.loadSettingJSON ?? p.settings ?? p.loadSetting ?? p.LoadSetting ?? null,
            department: String(p.departmentId ?? p.department ?? p.deptId ?? p.dept_id ?? '')
        };
    }

    function hasRosterPayload(p) {
        return p.worktimes != null && p.absences != null && p.settings != null;
    }

    function loadStandalonePayload(input, persist = true) {
        const p = unwrapPayload(input);
        if (!hasRosterPayload(p)) return false;
        try {
            // Snapshot timestamp belongs to the launcher payload, not the roster APIs.
            const rawCapturedAt = input?.capturedAt ?? input?.payload?.capturedAt;
            snapshotCapturedAt = rawCapturedAt && !Number.isNaN(Date.parse(rawCapturedAt))
                ? new Date(rawCapturedAt) : new Date();
            loadedDepartmentId = /^\d+$/.test(p.department) ? p.department : null;
            const employees = normalizeWorktimesResponse(p.worktimes);
            const rawAbsences = normalizeAbsenceResponse(p.absences);
            const trainingActivities = rawAbsences.filter(isTrainingActivity);
            const absences = buildUnavailableAbsences(rawAbsences);
            const functionMap = buildFunctionMap(p.settings);
            currentDays = buildDays(employees, absences, functionMap, trainingActivities);
            const dates = Object.keys(currentDays).sort();
            if (!dates.length) throw new Error('No scheduled coworkers found in the received roster.');
            if (!selectedDate || !currentDays[selectedDate]) selectedDate = dates[0];
            document.getElementById('tp-loader-card')?.remove();
            document.body.style.margin = '0';
            document.body.style.background = '#F3F4F5';
            renderPanel();
            if (persist) saveSnapshot(input);
            return true;
        } catch (error) {
            console.error('TimePlan Tools standalone payload error:', error);
            setStandaloneStatus('Could not process TimePlan roster: ' + (error?.message || error), true);
            return true;
        }
    }

    window.addEventListener('message', event => {
        // The launcher runs on ikea.timeplan-software.net and sends the already-fetched JSON here.
        if (event.origin !== 'https://ikea.timeplan-software.net' || event.source !== window.opener) return;
        if (event.data?.type !== 'TIMEPLAN_TOOLS_DATA' && event.data?.type !== 'TIMEPLAN_TOOLS_REFRESHED') return;
        loadStandalonePayload(event.data);
    });

    // Also accept a same-page test payload if one was placed before this script loaded.
    if (window.__TIMEPLAN_TOOLS_PAYLOAD__) loadStandalonePayload(window.__TIMEPLAN_TOOLS_PAYLOAD__);
    else if (!restoreSnapshot()) setStandaloneStatus('Open Department Plan and launch TimePlan Tools from your Favorites bar.');
})();
