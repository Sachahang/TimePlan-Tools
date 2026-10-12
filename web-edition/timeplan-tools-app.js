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



    // Core modules load before this application (see index.html).
    if (!window.TimePlanCore?.createTimeUtils ||
        !window.TimePlanCore?.createFunctionUtils ||
        !window.TimePlanCore?.createRosterProcessing) {
        throw new Error('TimePlan Tools: Core modules are missing. Refresh and try again.');
    }
    const { getDateKey, formatTime, timeToMinutes, minutesBetween, getWorkerEffectiveStart, sortWorkersByStart, sortWorkersByOfficialStart, localDateObject, formatDate, formatShortDate, formatGeneratedTime } = window.TimePlanCore.createTimeUtils({});
    const { timePlanColorToHex, normalizeHexColor, getContrastTextColor, buildFunctionMap, getSpecialFunctionBadge, abbreviateFunctionName, getFunctionBadges, getCapabilityLabels, getFunctionNames, getFunctionBadgeStyle, renderCapabilityBadges, getFunctionBarBackground } = window.TimePlanCore.createFunctionUtils({
        TP_BLUE, minutesBetween, escapeHTML
    });
    const { normalizeWorktimesResponse, normalizeAbsenceResponse, mergeContiguousWorktimes, mergeFunctionSegments, getFunctionSegments, getAbsenceActivityText, isTrainingActivity, buildUnavailableAbsences, maxTimestamp, minTimestamp, clipWorktimeDetails, subtractAbsencesFromWorktime, getRelevantAbsencesForWorktime, buildDays } = window.TimePlanCore.createRosterProcessing({
        getDateKey, sortWorkersByStart
    });

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


    // ---------- Response normalization ----------


    // ---------- Colors / functions / badges ----------


    // ---------- Worktime merge ----------


    // ---------- Absence / effective presence ----------


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

    // Board state operations now live in the Interactive Board module.
    const boardState = window.TimePlanInteractiveBoard.createBoardState({
        boardAssignments, notPresentByDate, externalWorkersByDate,
        unassignedCollapsedByDate,
        getSelectedDate: () => selectedDate,
        getCurrentDays: () => currentDays,
        BOARD_AREAS, timeToMinutes, formatTime, sortWorkersByStart,
        renderPanel
    });
    const {
        getWorkerKey, getAssignmentsForSelectedDate, getNotPresentForSelectedDate,
        getExternalWorkersForSelectedDate, getBoardWorkersForSelectedDate,
        getWorkerAssignment, assignWorker, setWorkerNotPresent,
        addExternalHelp, editExternalHelp, removeExternalHelp, resetBoard,
        buildWorkersByArea, findAreaInfo
    } = boardState;

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

    // Board controls, magnets and drop zones are now provided by the
    // Interactive Board module. Dependencies preserve existing behavior.
    const boardComponents = window.TimePlanInteractiveBoard.createBoardComponents({
        TOOL_FONT, TP_BLUE, TP_LIGHT_BLUE, escapeHTML, formatTime,
        getWorkerKey, isWorkerNotPresent, getFunctionBarBackground,
        renderCapabilityBadges, renderAbsenceIndicator, setWorkerNotPresent,
        editExternalHelp, removeExternalHelp, groupUnassignedWorkers,
        sortWorkersByStart, getWorkerEffectiveStart, assignWorker, renderPanel,
        applyBasicPlan
    });
    const { createBasicPlanMenu, createWorkerMagnet, createDropZone } = boardComponents;

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

    // Legacy in-page Board Planning renderer and its Export menu were removed.
    // The operational board opens through openInteractiveBoard() above.

    // ---------- CSV ----------

    // CSV and PDF exports now live in the Interactive Board module.
    const boardExports = window.TimePlanInteractiveBoard.createBoardExports({
        getBoardWorkersForSelectedDate,
        getSelectedDate: () => selectedDate,
        getCurrentDays: () => currentDays,
        sortWorkersByStart, findAreaInfo, getWorkerAssignment,
        isWorkerNotPresent, getCapabilityLabels, getFunctionNames,
        formatTime, BOARD_DEPARTMENT_CODE, buildWorkersByArea,
        BOARD_AREAS, escapeHTML, TOOL_FONT, TP_BLUE,
        getFunctionBarBackground, renderCapabilityBadges,
        renderAbsenceIndicator, getUniqueCoworkerCount,
        formatDate, formatGeneratedTime
    });
    const { exportBoardToCSV, exportBoardToPDF, downloadBlob } = boardExports;

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
