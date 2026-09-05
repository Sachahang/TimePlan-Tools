// ==UserScript==
// @name         TimePlan Tools
// @namespace    timeplan-local-tools
// @version      1.14.5
// @description  Interactive Board header timestamps and more reliable drag-and-drop
// @match        https://ikea.timeplan-software.net/*
// @updateURL    https://raw.githubusercontent.com/Sachahang/TimePlan-Tools/main/TimePlan-Tools.user.js
// @downloadURL  https://raw.githubusercontent.com/Sachahang/TimePlan-Tools/main/TimePlan-Tools.user.js
// @grant        none
// ==/UserScript==

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

    const BOARD_DEPARTMENT_ID = '159';
    const BOARD_DEPARTMENT_CODE = '094-4050';

    let currentDays = {};
    let selectedDate = null;
    let activeView = 'sorted';
    let draggedWorkerKey = null;
    const boardAssignments = {};
    const unassignedCollapsedByDate = {};
    const notPresentByDate = {};
    const externalWorkersByDate = {};


    const BOARD_AREAS = [
        { group: 'Click & Collect', id: 'cc', areas: [
            { id: 'cc-floor', name: 'Floor' },
            { id: 'cc-mh', name: 'MH' },
            { id: 'cc-reachtruck', name: 'Reachtruck' },
            { id: 'cc-tpl', name: 'TPL' },
            { id: 'cc-extra', name: 'Extra' }
        ]},
        { group: 'LCD', id: 'lcd', areas: [
            { id: 'lcd-floor', name: 'Floor' },
            { id: 'lcd-mh', name: 'MH' },
            { id: 'lcd-reachtruck', name: 'Reachtruck' },
            { id: 'lcd-loading-checking', name: 'Loading & Checking' },
            { id: 'lcd-tpl', name: 'TPL' },
            { id: 'lcd-extra', name: 'Extra' }
        ]},
        { group: 'FullServe', id: 'fullserve', areas: [
            { id: 'fs-vulpicks', name: 'VULPICKS' },
            { id: 'fs-tpl', name: 'TPL' },
            { id: 'fs-external-returns', name: 'External Returns' },
            { id: 'fs-extra', name: 'Extra' }
        ]}
    ];

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
        return getCurrentDepartmentId() === BOARD_DEPARTMENT_ID;
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

    function buildUnavailableAbsences(absences) {
        return absences.filter(absence =>
            absence.physicallyPresent === false &&
            absence.employeeid !== undefined &&
            absence.from && absence.to
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

    function buildDays(employees, absences, functionMap) {
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

    function renderSortedAbsenceInline(worker) {
        const segments = worker.absenceSegments || [];
        if (!segments.length) return '';

        const times = segments
            .map(segment => `${formatTime(segment.start)}&ndash;${formatTime(segment.end)}`)
            .join(', ');

        return `<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:5px;margin-left:8px;color:#8A4B47;font-size:12px;font-weight:700;white-space:normal;"><span style="color:#9E2F28;font-size:11px;font-weight:900;letter-spacing:.2px;">ABS</span><span>${times}</span></span>`;
    }

    function renderSortedView(panel) {
        const workers = currentDays[selectedDate];
        if (!workers?.length) return panel.insertAdjacentHTML('beforeend', '<p>No coworkers found for this day.</p>');
        renderDayHeader(panel, workers);
        const groups = {};
        sortWorkersByOfficialStart(workers).forEach(worker => (groups[formatTime(worker.start)] ||= []).push(worker));

        Object.entries(groups).forEach(([start, group]) => {
            const element = document.createElement('div');
            element.style.cssText = 'display:grid;grid-template-columns:90px 1fr;border-bottom:2px solid #c9c9c9;padding:11px 0;';
            element.innerHTML = `
                <div><div style="font-size:18px;font-weight:800;color:${TP_BLUE};">${start}</div><div style="font-size:12px;font-weight:700;color:#666;margin-top:3px;">${group.length} coworker${group.length === 1 ? '' : 's'}</div></div>
                <div>${group.map(worker => `
                    <div style="display:grid;grid-template-columns:minmax(260px,390px) minmax(280px,360px) minmax(320px,1fr);align-items:center;column-gap:20px;padding:5px 0;">
                        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;"><span style="font-size:16px;font-weight:600;">${escapeHTML(worker.name)}</span>${renderCapabilityBadges(worker)}</div>
                        <div style="min-width:0;display:flex;flex-wrap:wrap;align-items:center;row-gap:3px;">
                            <span style="color:#555;white-space:nowrap;font-size:14px;font-weight:700;">${formatTime(worker.start)} &rarr; ${formatTime(worker.end)}</span>${renderSortedAbsenceInline(worker)}
                        </div>
                        <div>${renderFunctionBadges(worker)}</div>
                    </div>`).join('')}</div>`;
            panel.appendChild(element);
        });
    }

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
        return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || '').trim());
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

    function isEveningTeamWorker(worker) {
        return timeToMinutes(getWorkerEffectiveStart(worker)) >= (11 * 60);
    }

    function isLoadingBayWorker(worker) {
        const labels = new Set(getCapabilityLabels(worker));
        if (labels.has('LB')) return true;
        return getFunctionNames(worker).some(name => String(name).toLowerCase().includes('loading bay'));
    }

    function applyBasicPlan(mode) {
        const workers = getBoardWorkersForSelectedDate();
        const wantEvening = mode === 'evening';

        // Basic Plan is deliberately conservative:
        // it only assigns coworkers who are still in Unassigned.
        const eligible = sortWorkersByStart(workers.filter(worker =>
            !worker.isExternal &&
            !isWorkerNotPresent(worker) &&
            getWorkerAssignment(worker) === 'unassigned' &&
            isEveningTeamWorker(worker) === wantEvening
        ));

        if (!eligible.length) return;

        const pickers = [];

        eligible.forEach(worker => {
            const group = getUnassignedRoleGroup(worker);

            if (isLoadingBayWorker(worker)) {
                assignWorker(getWorkerKey(worker), 'lcd-loading-checking');
            } else if (group.id === 'coordinators' || group.id === 'order-auditors') {
                assignWorker(getWorkerKey(worker), 'leadership');
            } else if (group.id === 'forklift-drivers') {
                assignWorker(
                    getWorkerKey(worker),
                    wantEvening ? 'fs-vulpicks' : 'cc-reachtruck'
                );
            } else {
                pickers.push(worker);
            }
        });

        // One MH picker by default; use two when the team is large.
        const mhCount = pickers.length >= 8 ? 2 : (pickers.length ? 1 : 0);

        pickers.forEach((worker, index) => {
            assignWorker(
                getWorkerKey(worker),
                index < mhCount
                    ? (wantEvening ? 'lcd-mh' : 'cc-mh')
                    : (wantEvening ? 'lcd-floor' : 'cc-floor')
            );
        });

        const remaining = workers.filter(worker => getWorkerAssignment(worker) === 'unassigned').length;
        if (!remaining) unassignedCollapsedByDate[selectedDate] = true;
        renderPanel();
    }

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

        if (isBoardDepartment()) {
            const boardButton = document.createElement('button');
            boardButton.textContent = 'Go to Board Planning';
            boardButton.title = 'Open the operational Interactive Board for the selected day';
            boardButton.style.cssText = `font-family:${TOOL_FONT};border:2px solid ${TP_BLUE};background:#fff;color:${TP_BLUE};padding:9px 16px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;`;
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
            tabs.appendChild(boardButton);
        }

        panel.appendChild(tabs);
    }

    function renderDayHeader(panel, workers) {
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;';
        header.innerHTML = `<div style="font-size:20px;font-weight:800;">${escapeHTML(formatDate(workers[0].start))}</div><div style="padding:5px 10px;background:#f2f2f2;border-radius:7px;font-size:13px;font-weight:700;color:#555;">${getUniqueCoworkerCount(workers)} coworkers</div>`;
        panel.appendChild(header);
    }

    // ---------- Interactive HTML ----------

    async function getInteractiveExportData() {
        const workers = getBoardWorkersForSelectedDate();
        const fontFamily = getNativeTimePlanFontFamily();
        const portableFontFaceCSS = await collectPortableTimePlanFontFaceCSS(fontFamily);
        return {
            date: selectedDate,
            formattedDate: workers.length ? formatDate(workers[0].start) : selectedDate,
            department: BOARD_DEPARTMENT_CODE,
            fontFamily,
            fontFaceCSS: portableFontFaceCSS || collectTimePlanFontFaceCSS(),
            stylesheetLinks: getTimePlanStylesheetLinksHTML(),
            workers: sortWorkersByStart(workers).map(worker => ({
                key: getWorkerKey(worker),
                name: worker.name,
                employeeId: worker.employeeId,
                isExternal: Boolean(worker.isExternal),
                start: formatTime(worker.start),
                end: formatTime(worker.end),
                effectiveStart: formatTime(getWorkerEffectiveStart(worker)),
                absences: (worker.absenceSegments || []).map(segment => ({ start: formatTime(segment.start), end: formatTime(segment.end) })),
                badges: getFunctionBadges(worker),
                functionNames: getFunctionNames(worker),
                functionBar: worker.isExternal ? '#777777' : getFunctionBarBackground(worker)
            })),
            areas: BOARD_AREAS,
            assignments: { ...getAssignmentsForSelectedDate() },
            notPresent: { ...getNotPresentForSelectedDate() }
        };
    }

    async function buildInteractiveBoardHTML() {
        const data = await getInteractiveExportData();
        const dataJSON = safeJSONStringify({
            date: data.date,
            formattedDate: data.formattedDate,
            department: data.department,
            fontFamily: data.fontFamily,
            fontFaceCSS: data.fontFaceCSS,
            workers: data.workers,
            areas: data.areas
        });
        const stateJSON = safeJSONStringify({ assignments: data.assignments, notPresent: data.notPresent, lastUpdated: new Date().toISOString() });

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Interactive Board - ${escapeHTML(data.date)}</title>
<style>
${escapeStyleClose(data.fontFaceCSS)}
*{box-sizing:border-box}body,button,input,select,textarea{font-family:${data.fontFamily || TOOL_FONT}!important}body{margin:0;padding:24px;background:#F3F4F5;color:#222}.header{position:relative;min-height:112px;margin-bottom:20px;padding-right:760px}.title{font-size:26px;font-weight:800;color:${TP_BLUE}}.subtitle{margin-top:4px;font-size:15px;font-weight:700}.subtitle-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.header-sep{color:#AAA}.plan-updated{color:#555;font-size:12px;font-weight:700}.local-clock{margin-top:3px;color:#777;font-size:12px;font-weight:700}.meta{margin-top:3px;color:#777;font-size:12px}.actions{position:absolute;top:0;right:0;display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}button{font-family:inherit;border-radius:7px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap}.primary{border:1px solid ${TP_BLUE};background:${TP_BLUE};color:white}.secondary{border:1px solid #AAA;background:white;color:#333}.danger{border:1px solid #B42318;background:#B42318;color:white}.share-wrap{position:relative}.share-menu{display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:260px;background:white;border:1px solid #CCC;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000}.share-menu button{display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:11px 13px;color:#222;font-size:12px;font-weight:800;border-radius:0}.share-menu button:first-child{border-top:none}.status{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;font-size:12px;color:#666}.unassigned,.leadership,.area{border-radius:8px;padding:9px}.unassigned-sticky{position:sticky;top:8px;z-index:60;margin-bottom:12px;padding:4px 0;background:#F3F4F5;border-radius:9px;box-shadow:0 8px 16px -15px rgba(0,0,0,.7);overscroll-behavior:contain}.unassigned{border:2px dashed #AAA;background:#FFF}.leadership{margin-bottom:16px;border:2px solid ${TP_BLUE};background:${TP_LIGHT_BLUE}}.board{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:14px;align-items:start}.flow{border:1px solid #D5D5D5;border-radius:9px;overflow:visible;background:#FFF}.flow-header{position:sticky;top:var(--flow-sticky-top,8px);z-index:45;display:flex;justify-content:space-between;align-items:center;padding:12px 13px;background:rgba(0,88,163,.93);color:white;font-size:15px;font-weight:800;border-radius:8px 8px 0 0}.flow-count,.area-count{display:inline-flex;justify-content:center;align-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:800}.flow-count{background:white;color:${TP_BLUE}}.area-count{background:#E6E6E6;color:#333}.flow-content{display:flex;flex-direction:column;gap:10px;padding:10px}.area{min-height:105px;background:#F8F8F8;border:2px dashed #C5C5C5;transition:min-height .16s ease,background .16s ease,border-color .16s ease}.area.compact-empty{min-height:46px;padding:8px 9px}.area-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:13px;font-weight:800;gap:8px}.compact-empty .area-header{margin-bottom:0}.cards{display:flex;flex-wrap:wrap;min-height:45px}.compact-empty .cards{display:none;min-height:0}.compact-empty.drop-active{min-height:82px}.compact-empty.drop-active .cards{display:flex}.compact-empty.drop-active .compact-hint{color:${TP_BLUE}}.worker{position:relative;overflow:visible;margin:4px;min-width:145px;max-width:235px;padding:8px 10px 8px 14px;background:white;border:1px solid #C8C8C8;border-radius:7px;box-shadow:0 2px 5px rgba(0,0,0,.12);cursor:grab;user-select:none}.worker.not-present{background:#ECECEC;border-color:#B9B9B9;cursor:pointer}.worker.not-present>.function-bar,.worker.not-present>.worker-name,.worker.not-present>.worker-time,.worker.not-present>.worker-absence{opacity:.52}.worker.menu-open{z-index:1000001}.worker.magnet-clicked{animation:magnetPulse .18s ease-out}@keyframes magnetPulse{0%{box-shadow:0 2px 5px rgba(0,0,0,.12)}45%{box-shadow:0 0 0 4px rgba(0,88,163,.20),0 2px 5px rgba(0,0,0,.12)}100%{box-shadow:0 2px 5px rgba(0,0,0,.12)}}.function-bar{position:absolute;left:0;top:0;bottom:0;width:5px;border-radius:7px 0 0 7px}.worker-name{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:14px;font-weight:800}.worker-time{margin-top:4px;font-size:12px}.worker-start{font-weight:900}.worker-arrow{font-weight:700;color:#999}.worker-end{font-weight:700;color:#666}.worker-absence{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:3px}.absence-item{display:inline-flex;align-items:center;gap:4px}.absence-label{padding:2px 5px;border:1px solid #C85B52;border-radius:4px;background:#FFF8F7;color:#9E2F28;font-size:9px;font-weight:900}.absence-time{color:#8A4B47;font-size:10px;font-weight:700}.role-divider,.shift-divider{flex-basis:100%;display:flex;align-items:center;gap:8px;margin:7px 3px 3px;color:#777;font-size:9px;font-weight:900;letter-spacing:.45px;text-transform:uppercase}.role-divider:before,.role-divider:after,.shift-divider:before,.shift-divider:after{content:'';flex:1;height:1px;background:#D4D4D4}.badge{display:inline-flex;align-items:center;justify-content:center;height:19px;padding:0 6px;border-radius:999px;font-size:9px;font-weight:800;white-space:nowrap}.drop-active{border-color:${TP_BLUE}!important;background:rgba(0,88,163,.10)!important}.magnet-menu{display:none;position:fixed;z-index:1000000;min-width:180px;background:white;border:1px solid #BBB;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;opacity:1}.magnet-menu button{display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:9px 11px;color:#222;font-size:11px;font-weight:800;border-radius:0}.compact-hint{margin-left:auto;color:#999;font-size:10px;font-weight:800}@media(max-width:1100px){.header{padding-right:0;padding-top:110px}.actions{left:0;right:0;justify-content:flex-start}.board{grid-template-columns:1fr}}@media(max-width:620px){body{padding:16px}.header{padding-top:165px}}
</style>
</head>
<body>
<script id="tp-state" type="application/json">${stateJSON}</script>
<div class="header"><div><div class="title">Daily Board Plan</div><div class="subtitle subtitle-line"><span id="dateLabel"></span><span class="header-sep">&middot;</span><span class="plan-updated" id="planUpdated"></span></div><div class="local-clock" id="localClock"></div><div class="meta">Department ${escapeHTML(data.department)}</div></div><div class="actions"><div style="position:relative"><button class="secondary" id="basicPlanButton" style="border-color:${TP_BLUE};color:${TP_BLUE}">Create Basic Plan</button><div id="basicPlanMenu" style="display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:245px;background:white;border:1px solid #CCC;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000"><button class="basic-plan-choice" data-mode="morning" style="display:block;width:100%;text-align:left;border:none;background:white;padding:10px 13px;color:#222"><strong>Morning Default</strong><span style="display:block;margin-top:2px;font-size:10px;color:#777">Morning team only - Unassigned coworkers</span></button><button class="basic-plan-choice" data-mode="evening" style="display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:10px 13px;color:#222"><strong>Evening Default</strong><span style="display:block;margin-top:2px;font-size:10px;color:#777">Evening team only - Unassigned coworkers</span></button></div></div><button class="secondary" id="externalButton">+ External Help</button><div class="share-wrap"><button class="primary" id="shareButton">Share Plan</button><div class="share-menu" id="shareMenu"><button data-share="html">Export Interactive Board (.html)</button><button data-share="pdf">Export as PDF</button></div></div><button class="danger" id="resetButton">Reset Board</button></div></div>
<div class="status"><span id="coworkerCount"></span><span id="lastChange"></span></div>
<div id="unassignedWrapper"><div id="unassigned"></div></div><div id="leadership"></div><div id="board" class="board"></div>
<script>
const DATA=${dataJSON};
let state={assignments:{},notPresent:{},lastUpdated:null};
try{state={...state,...JSON.parse(document.getElementById('tp-state').textContent||'{}')}}catch{}
let assignments=state.assignments||{};
let notPresent=state.notPresent||{};
let externalWorkers=Array.isArray(state.externalWorkers)?state.externalWorkers:[];
let workerOverrides=state.workerOverrides||{};
let lastUpdated=state.lastUpdated||new Date().toISOString();
const ORIGINAL_WORKERS=new Map(DATA.workers.map(w=>[w.key,{start:w.start,end:w.end,effectiveStart:w.effectiveStart}]));
externalWorkers.forEach(w=>{if(w&&w.key&&!DATA.workers.some(x=>x.key===w.key))DATA.workers.push(w)});
Object.entries(workerOverrides).forEach(([key,o])=>{const w=DATA.workers.find(x=>x.key===key);if(w&&o){if(o.start)w.start=o.start;if(o.end)w.end=o.end;if(o.effectiveStart)w.effectiveStart=o.effectiveStart}});
let draggedKey=null;
let unassignedCollapsed=false;
let dirty=false;
function setDirty(value=true){dirty=value}
function syncExternalWorkers(){externalWorkers=DATA.workers.filter(w=>w.isExternal).map(w=>({...w}))}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function contrast(hex){const c=String(hex||'#666666').replace('#','');const r=parseInt(c.substring(0,2),16),g=parseInt(c.substring(2,4),16),b=parseInt(c.substring(4,6),16);return((r*299+g*587+b*114)/1000)>155?'#222':'#FFF'}
function assignment(w){return assignments[w.key]||'unassigned'}
function workersFor(area){return DATA.workers.filter(w=>assignment(w)===area)}
function timeMinutes(v){const p=String(v||'00:00').split(':').map(Number);return((p[0]||0)*60)+(p[1]||0)}
function roleGroup(w){if(w.isExternal)return{id:'external-help',label:'EXTERNAL HELP'};const labels=new Set((w.badges||[]).map(b=>b.label));if(labels.has('COORD'))return{id:'coordinators',label:'COORDINATORS'};if(labels.has('OA'))return{id:'order-auditors',label:'ORDER AUDITORS'};if(labels.has('FLT'))return{id:'forklift-drivers',label:'FORKLIFT DRIVERS'};return{id:'order-pickers',label:'ORDER PICKERS'}}
function sortWorkers(ws){return[...ws].sort((a,b)=>timeMinutes(a.effectiveStart||a.start)-timeMinutes(b.effectiveStart||b.start)||timeMinutes(a.start)-timeMinutes(b.start)||a.name.localeCompare(b.name))}
function groupedUnassigned(ws){const defs=[['coordinators','COORDINATORS'],['order-auditors','ORDER AUDITORS'],['forklift-drivers','FORKLIFT DRIVERS'],['order-pickers','ORDER PICKERS'],['external-help','EXTERNAL HELP']];return defs.map(([id,label])=>({id,label,workers:sortWorkers(ws.filter(w=>roleGroup(w).id===id))})).filter(g=>g.workers.length)}
function isLB(w){const labels=new Set((w.badges||[]).map(b=>b.label));return labels.has('LB')||(w.functionNames||[]).some(n=>String(n).toLowerCase().includes('loading bay'))}
function applyBasicPlan(mode){const evening=mode==='evening';const eligible=sortWorkers(DATA.workers.filter(w=>!w.isExternal&&!notPresent[w.key]&&assignment(w)==='unassigned'&&((timeMinutes(w.effectiveStart||w.start)>=660)===evening)));const pickers=[];eligible.forEach(w=>{const g=roleGroup(w);if(isLB(w))assignments[w.key]='lcd-loading-checking';else if(g.id==='coordinators'||g.id==='order-auditors')assignments[w.key]='leadership';else if(g.id==='forklift-drivers')assignments[w.key]=evening?'fs-vulpicks':'cc-reachtruck';else pickers.push(w)});const mh=pickers.length>=8?2:(pickers.length?1:0);pickers.forEach((w,i)=>assignments[w.key]=i<mh?(evening?'lcd-mh':'cc-mh'):(evening?'lcd-floor':'cc-floor'));if(!workersFor('unassigned').length)unassignedCollapsed=true;setDirty();last((evening?'Evening':'Morning')+' basic plan created');render()}
function badgesHTML(w){return(w.badges||[]).map(b=>{const c=b.color||'#666';return '<span class="badge" title="'+esc(b.title)+'" style="background:'+c+';border:1px solid '+c+';color:'+contrast(c)+'">'+esc(b.label)+'</span>'}).join('')}
function absenceHTML(w){if(!(w.absences||[]).length)return'';return '<div class="worker-absence">'+w.absences.map(a=>'<span class="absence-item"><span class="absence-label">ABS</span><span class="absence-time">'+esc(a.start)+'&ndash;'+esc(a.end)+'</span></span>').join('')+'</div>'}
function formatClock(d,withSeconds=false){return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',...(withSeconds?{second:'2-digit'}:{})})}
function refreshHeaderTimes(){const updated=document.getElementById('planUpdated');if(updated){const d=new Date(lastUpdated);updated.textContent='Last updated plan: '+(Number.isNaN(d.getTime())?'--:--':formatClock(d))}const clock=document.getElementById('localClock');if(clock)clock.textContent='Local time: '+formatClock(new Date(),true)}
function touchPlan(){lastUpdated=new Date().toISOString();refreshHeaderTimes()}
function last(text){document.getElementById('lastChange').textContent=text;touchPlan()}
function workerHTML(w){const np=!!notPresent[w.key];const adjusted=!!workerOverrides[w.key]&&!w.isExternal;return '<div class="worker'+(np?' not-present':'')+'" draggable="'+(!np)+'" data-worker-key="'+esc(w.key)+'"><span class="function-bar" style="background:'+(np?'#999':w.functionBar)+'"></span><div class="worker-name"><span>'+esc(w.name)+'</span>'+(w.isExternal?'<span class="badge" style="background:#666;color:#fff">EXT</span>':badgesHTML(w))+(adjusted?'<span class="badge" style="background:#7A5AF8;color:#fff" title="Board time adjusted manually">TIME</span>':'')+(np?'<span class="badge" style="background:#666;color:#fff">ABSENCE</span>':'')+'</div><div class="worker-time"><span class="worker-start">'+esc(w.start)+'</span><span class="worker-arrow"> &rarr; </span><span class="worker-end">'+esc(w.end)+'</span></div>'+(w.isExternal?'<div style="margin-top:3px;color:#777;font-size:10px;font-weight:700">External help</div>':absenceHTML(w))+'<div class="magnet-menu"><button data-action="presence">'+(np?'Mark as available':'Mark as absent')+'</button><button data-action="time">Edit board time</button>'+(adjusted?'<button data-action="restore-time">Restore TimePlan time</button>':'')+(w.isExternal?'<button data-action="edit">Edit external help</button><button data-action="remove" style="color:#A12622">Remove external help</button>':'')+'</div></div>'}
function cardsHTML(ws,id){if(id==='unassigned')return groupedUnassigned(ws).map(g=>'<div class="role-divider"><span>'+esc(g.label)+' &middot; '+g.workers.length+'</span></div>'+g.workers.map(workerHTML).join('')).join('');let eveningAdded=false;return sortWorkers(ws).map(w=>{const evening=timeMinutes(w.effectiveStart||w.start)>=660;let d='';if(!eveningAdded&&evening){d='<div class="shift-divider"><span>Evening Team</span></div>';eveningAdded=true}return d+workerHTML(w)}).join('')}
function makeZone(id,name,extra='area'){const ws=workersFor(id);if(id==='unassigned'&&unassignedCollapsed)return '<div class="'+extra+' dropzone" data-area-id="'+id+'"><div class="area-header" style="margin-bottom:0"><span>'+esc(name)+' <span class="area-count">'+ws.length+'</span></span><button class="secondary" id="showUnassigned" style="padding:5px 10px;font-size:11px">Show</button></div></div>';const compact=!ws.length&&id!=='unassigned';const toggle=id==='unassigned'?'<button class="secondary" id="hideUnassigned" style="margin-left:auto;margin-right:7px;padding:4px 9px;font-size:10px">Hide</button>':'';return '<div class="'+extra+' dropzone'+(compact?' compact-empty':'')+'" data-area-id="'+id+'"><div class="area-header"><span>'+esc(name)+'</span>'+(compact?'<span class="compact-hint">Drop here</span>':'')+toggle+'<span class="area-count">'+ws.length+'</span></div><div class="cards">'+cardsHTML(ws,id)+'</div></div>'}
function render(){document.getElementById('dateLabel').textContent=DATA.formattedDate;refreshHeaderTimes();const active=DATA.workers.filter(w=>!notPresent[w.key]).length;const ext=DATA.workers.filter(w=>w.isExternal).length;const np=DATA.workers.filter(w=>notPresent[w.key]).length;document.getElementById('coworkerCount').textContent=active+' active'+(ext?' \u00B7 '+ext+' external':'')+(np?' \u00B7 '+np+' absence':'');const uw=document.getElementById('unassignedWrapper');if(!workersFor('unassigned').length)unassignedCollapsed=true;uw.className='unassigned-sticky';uw.style.maxHeight=unassignedCollapsed?'none':'38vh';uw.style.overflowY=unassignedCollapsed?'visible':'auto';document.getElementById('unassigned').innerHTML=makeZone('unassigned','UNASSIGNED','unassigned');document.getElementById('leadership').innerHTML=makeZone('leadership','ORDER AUDITOR - COORDINATOR','leadership');document.getElementById('board').innerHTML=DATA.areas.map(g=>'<section class="flow"><div class="flow-header"><span>'+esc(g.group)+'</span><span class="flow-count">'+g.areas.reduce((t,a)=>t+workersFor(a.id).filter(w=>!notPresent[w.key]).length,0)+'</span></div><div class="flow-content">'+g.areas.map(a=>makeZone(a.id,a.name)).join('')+'</div></section>').join('');bind();updateSticky()}
function updateSticky(){const w=document.getElementById('unassignedWrapper');document.documentElement.style.setProperty('--flow-sticky-top',(Math.ceil(w.getBoundingClientRect().height)+16)+'px')}
function bind(){const hide=document.getElementById('hideUnassigned');if(hide)hide.onclick=e=>{e.stopPropagation();unassignedCollapsed=true;render()};const show=document.getElementById('showUnassigned');if(show)show.onclick=e=>{e.stopPropagation();unassignedCollapsed=false;render()};document.querySelectorAll('.worker').forEach(el=>{const key=el.dataset.workerKey;el.addEventListener('click',e=>{if(e.target.closest('.magnet-menu button'))return;e.stopPropagation();el.classList.remove('magnet-clicked');void el.offsetWidth;el.classList.add('magnet-clicked');setTimeout(()=>el.classList.remove('magnet-clicked'),190);document.querySelectorAll('.worker.menu-open').forEach(w=>{if(w!==el)w.classList.remove('menu-open')});document.querySelectorAll('.magnet-menu').forEach(m=>{if(m!==el.querySelector('.magnet-menu'))m.style.display='none'});const m=el.querySelector('.magnet-menu');const opening=m.style.display!=='block';if(!opening){m.style.display='none';el.classList.remove('menu-open');return}el.classList.add('menu-open');m.style.display='block';const r=el.getBoundingClientRect();const mr=m.getBoundingClientRect();let left=Math.min(Math.max(8,r.left),window.innerWidth-mr.width-8);let top=r.bottom+5;if(top+mr.height>window.innerHeight-8)top=Math.max(8,r.top-mr.height-5);m.style.left=left+'px';m.style.top=top+'px'});if(el.getAttribute('draggable')==='true'){el.addEventListener('dragstart',e=>{draggedKey=key;e.dataTransfer.setData('text/plain',key);el.style.opacity='.45'});el.addEventListener('dragend',()=>{draggedKey=null;el.style.opacity=''})}el.querySelectorAll('.magnet-menu button').forEach(btn=>btn.onclick=e=>{e.stopPropagation();const w=DATA.workers.find(x=>x.key===key);if(!w)return;if(btn.dataset.action==='presence'){notPresent[key]=!notPresent[key];if(notPresent[key])assignments[key]='unassigned';else delete notPresent[key];setDirty();last(notPresent[key]?'Marked as absent':'Marked as available');render()}else if(btn.dataset.action==='time'){const start=prompt('Board shift start (HH:MM):',w.start);if(start===null)return;const end=prompt('Board shift end (HH:MM):',w.end);if(end===null)return;if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');w.start=start;w.end=end;w.effectiveStart=start;if(w.isExternal)syncExternalWorkers();else workerOverrides[key]={start,end,effectiveStart:start};setDirty();last('Board time adjusted');render()}else if(btn.dataset.action==='restore-time'&&!w.isExternal){const o=ORIGINAL_WORKERS.get(key);if(o){w.start=o.start;w.end=o.end;w.effectiveStart=o.effectiveStart;delete workerOverrides[key];setDirty();last('TimePlan time restored');render()}}else if(btn.dataset.action==='edit'&&w.isExternal){const name=prompt('External coworker name:',w.name);if(!name)return;const start=prompt('Shift start (HH:MM):',w.start);const end=prompt('Shift end (HH:MM):',w.end);if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');w.name=name.trim();w.start=start;w.end=end;w.effectiveStart=start;syncExternalWorkers();setDirty();last('External help updated');render()}else if(btn.dataset.action==='remove'&&w.isExternal){if(confirm('Remove '+w.name+'?')){const i=DATA.workers.findIndex(x=>x.key===key);if(i>=0)DATA.workers.splice(i,1);delete assignments[key];delete notPresent[key];syncExternalWorkers();setDirty();last('External help removed');render()}}})});document.querySelectorAll('.dropzone').forEach(z=>{let dragDepth=0;z.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;z.classList.add('drop-active')});z.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';z.classList.add('drop-active')});z.addEventListener('dragleave',e=>{dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)z.classList.remove('drop-active')});z.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();dragDepth=0;z.classList.remove('drop-active');const key=e.dataTransfer.getData('text/plain')||draggedKey;if(!key||notPresent[key])return;assignments[key]=z.dataset.areaId;setDirty();last('Moved to '+z.dataset.areaId);render()})})}
function addExternal(){const name=prompt('External coworker name:');if(!name)return;const start=prompt('Shift start (HH:MM):','08:00');const end=prompt('Shift end (HH:MM):','16:00');if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');const key='external|'+Date.now()+'-'+Math.random().toString(36).slice(2,7);DATA.workers.push({key,name:name.trim(),employeeId:'EXT',isExternal:true,start,end,effectiveStart:start,absences:[],badges:[],functionNames:[],functionBar:'#777777'});assignments[key]='unassigned';syncExternalWorkers();unassignedCollapsed=false;setDirty();last('External help added');render()}
function resetBoard(){if(!confirm('Reset the board? Assignments, absences, manual time changes and external help will be cleared.'))return;assignments={};notPresent={};workerOverrides={};for(const [key,o] of ORIGINAL_WORKERS.entries()){const w=DATA.workers.find(x=>x.key===key);if(w){w.start=o.start;w.end=o.end;w.effectiveStart=o.effectiveStart}}for(let i=DATA.workers.length-1;i>=0;i--)if(DATA.workers[i].isExternal)DATA.workers.splice(i,1);externalWorkers=[];unassignedCollapsed=false;setDirty();last('Board reset');render()}
function saveHTML(){syncExternalWorkers();document.getElementById('tp-state').textContent=JSON.stringify({assignments,notPresent,externalWorkers,workerOverrides,lastUpdated});const html='<!DOCTYPE html>\\n'+document.documentElement.outerHTML;const blob=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='TimePlan-Interactive-Board-'+DATA.department+'-'+DATA.date+'.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setDirty(false);document.getElementById('lastChange').textContent='Interactive Board exported';refreshHeaderTimes()}
function exportPDF(){window.print()}
const basicPlanButton=document.getElementById('basicPlanButton'),basicPlanMenu=document.getElementById('basicPlanMenu'),shareButton=document.getElementById('shareButton'),shareMenu=document.getElementById('shareMenu');basicPlanButton.onclick=e=>{e.stopPropagation();shareMenu.style.display='none';basicPlanMenu.style.display=basicPlanMenu.style.display==='block'?'none':'block'};document.querySelectorAll('.basic-plan-choice').forEach(b=>b.onclick=e=>{e.stopPropagation();basicPlanMenu.style.display='none';applyBasicPlan(b.dataset.mode)});document.getElementById('externalButton').onclick=addExternal;shareButton.onclick=e=>{e.stopPropagation();basicPlanMenu.style.display='none';shareMenu.style.display=shareMenu.style.display==='block'?'none':'block'};shareMenu.onclick=e=>e.stopPropagation();shareMenu.querySelector('[data-share="html"]').onclick=()=>{shareMenu.style.display='none';saveHTML()};shareMenu.querySelector('[data-share="pdf"]').onclick=()=>{shareMenu.style.display='none';exportPDF()};document.getElementById('resetButton').onclick=resetBoard;document.addEventListener('click',()=>{basicPlanMenu.style.display='none';shareMenu.style.display='none';document.querySelectorAll('.magnet-menu').forEach(m=>m.style.display='none');document.querySelectorAll('.worker.menu-open').forEach(w=>w.classList.remove('menu-open'))});window.addEventListener('beforeunload',e=>{if(!dirty)return;e.preventDefault();e.returnValue=''});window.addEventListener('resize',()=>requestAnimationFrame(updateSticky));setInterval(refreshHeaderTimes,1000);render();
<\/script>
</body>
</html>`;
    }

    async function openInteractiveBoard() {
        if (!isBoardDepartment()) return;
        const newWindow = window.open('', '_blank', 'width=1500,height=950');
        if (!newWindow) return alert('The browser blocked the new tab/window.');
        newWindow.document.write('<p style="font-family:Arial;padding:24px">Preparing portable Interactive Board...</p>');
        const html = await buildInteractiveBoardHTML();
        newWindow.document.open();
        newWindow.document.write(html);
        newWindow.document.close();
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
        const close = document.createElement('button');
        close.textContent = 'Close';
        close.style.cssText = `font-family:${TOOL_FONT};border:none;background:#eee;border-radius:5px;padding:8px 12px;cursor:pointer;`;
        close.onclick = () => { panel.remove(); updateButtonState(); };
        top.appendChild(close);
        panel.appendChild(top);
        renderDayButtons(panel);
        renderViewTabs(panel);
        // Keep TimePlan Tools focused on the roster. The operational board
        // opens in its own Interactive Board tab via Go to Board Planning.
        renderSortedView(panel);
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
            const absences = buildUnavailableAbsences(normalizeAbsenceResponse(absenceJSON));
            const functionMap = buildFunctionMap(settingsJSON);
            currentDays = buildDays(employees, absences, functionMap);
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

    window.addEventListener('hashchange', updateFloatingButton);
    setInterval(updateFloatingButton, 1000);
    updateFloatingButton();
})();
