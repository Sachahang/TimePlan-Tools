/* TimePlan Tools — Interactive Board module (preparation)
   Destination: web-edition/src/interactive-board/interactive-board.js

   Step 67: Basic Plan logic lives here; live roster state stays in the app.
   The portable handover HTML remains independent and unchanged.
*/
(function (global) {
    'use strict';

    // A small, reusable boundary for the future Interactive Board extraction.
    // Department-specific configuration stays in src/departments/full-serve.js.
    function getDepartmentConfiguration() {
        const config = global.TimePlanFullServe;
        if (!config || !Array.isArray(config.areas)) {
            throw new Error('Interactive Board requires the Full Serve department module.');
        }
        return config;
    }

    function isSupportedDepartment(departmentId) {
        return String(departmentId ?? '') === String(getDepartmentConfiguration().departmentId);
    }

    function getDefaultFlows() {
        return getDepartmentConfiguration().areas.map(flow => ({
            id: flow.id,
            group: flow.group,
            areas: flow.areas.map(area => ({ id: area.id, name: area.name }))
        }));
    }

    // Basic Plan logic extracted from the main application in Step 67.
    // Dependencies are injected so this module does not own the live roster state.
    function createBasicPlan(deps) {
        const {
            timeToMinutes, getWorkerEffectiveStart, getFunctionBadges,
            getFunctionNames, getBoardWorkersForSelectedDate,
            isWorkerNotPresent, getWorkerAssignment, sortWorkersByStart,
            getUnassignedRoleGroup, BOARD_AREAS, assignWorker, getWorkerKey,
            onCompleted
        } = deps;

    function isEveningTeamWorker(worker) {
        return timeToMinutes(getWorkerEffectiveStart(worker)) >= (11 * 60);
    }

    function isLoadingBayWorker(worker) {
        const labels = getFunctionBadges(worker).flatMap(b => [b?.label, b?.title]).filter(Boolean).map(v => String(v).trim().toUpperCase());
        if (labels.some(v => v === 'LB' || v.includes('LOADING BAY'))) return true;
        const names = getFunctionNames(worker).map(name => String(name || '').trim().toLowerCase());
        if (names.some(name => name === 'lb' || name.includes('loading bay'))) return true;
        return (worker.functionSegments || []).some(segment => {
            const text = `${segment?.name || ''} ${segment?.label || ''}`.trim().toLowerCase();
            return text === 'lb' || text.includes('loading bay');
        });
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
            (isLoadingBayWorker(worker) || isEveningTeamWorker(worker) === wantEvening)
        ));

        if (!eligible.length) return;

        const pickers = [];

        eligible.forEach(worker => {
            const group = getUnassignedRoleGroup(worker);

            if (isLoadingBayWorker(worker)) {
                const lcd = BOARD_AREAS.find(group => group.id === 'lcd' || String(group.group || '').trim().toLowerCase() === 'lcd');
                const loading = lcd?.areas?.find(area => String(area.name || '').trim().toLowerCase() === 'loading & checking' || String(area.id || '').endsWith('-loading-checking'));
                if (loading) assignWorker(getWorkerKey(worker), loading.id);
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
        onCompleted(!remaining);
    }

        return Object.freeze({ applyBasicPlan });
    }

    // Prepare the snapshot consumed by the standalone board HTML generator.
    // Live roster state and browser/font helpers remain owned by the main app.
    function createExportData(deps) {
        const {
            getBoardWorkersForSelectedDate, getSelectedDate, getSnapshotCapturedAt,
            getNativeTimePlanFontFamily, collectPortableTimePlanFontFaceCSS,
            collectTimePlanFontFaceCSS, getTimePlanStylesheetLinksHTML,
            formatDate, formatTime, sortWorkersByStart, getWorkerKey,
            getWorkerEffectiveStart, getFunctionBadges, getFunctionNames,
            getFunctionBarBackground, getAssignmentsForSelectedDate,
            getNotPresentForSelectedDate, BOARD_DEPARTMENT_CODE, BOARD_AREAS
        } = deps;

        async function getInteractiveExportData() {
            const workers = getBoardWorkersForSelectedDate();
            const fontFamily = getNativeTimePlanFontFamily();
            const portableFontFaceCSS = await collectPortableTimePlanFontFaceCSS(fontFamily);
            return {
                date: getSelectedDate(),
                formattedDate: workers.length ? formatDate(workers[0].start) : getSelectedDate(),
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
                    allDayAbsenceNotes: worker.allDayAbsenceNotes || [],
                    badges: getFunctionBadges(worker),
                    functionNames: getFunctionNames(worker),
                    functionBar: worker.isExternal ? '#777777' : getFunctionBarBackground(worker)
                })),
                areas: BOARD_AREAS,
                assignments: { ...getAssignmentsForSelectedDate() },
                notPresent: { ...getNotPresentForSelectedDate() },
                snapshotCapturedAt: getSnapshotCapturedAt() ? getSnapshotCapturedAt().toISOString() : null
            };
        }

        return Object.freeze({ getInteractiveExportData });
    }

    // Generate the complete self-contained handover HTML.
    // The template is moved verbatim from the main app, including inline CSS/JS.
    function createStandaloneHTML(deps) {
        const {
            getInteractiveExportData, safeJSONStringify, escapeHTML,
            escapeStyleClose, TOOL_FONT, TP_BLUE, TP_LIGHT_BLUE
        } = deps;

        async function buildInteractiveBoardHTML() {
            const data = await getInteractiveExportData();
            const dataJSON = safeJSONStringify({
                date: data.date,
                formattedDate: data.formattedDate,
                department: data.department,
                snapshotCapturedAt: data.snapshotCapturedAt,
                fontFamily: data.fontFamily,
                fontFaceCSS: data.fontFaceCSS,
                workers: data.workers,
                areas: data.areas
            });
            const stateJSON = safeJSONStringify({ assignments: data.assignments, notPresent: data.notPresent, supportDestinations: {}, supportTimes: {}, breaks: {}, boardFlows: data.areas, lastUpdated: new Date().toISOString() });
    
            return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>Interactive Board - ${escapeHTML(data.date)}</title>
    <style>
    ${escapeStyleClose(data.fontFaceCSS)}
    *{box-sizing:border-box}body,button,input,select,textarea{font-family:${data.fontFamily || TOOL_FONT}!important}body{margin:0;padding:24px;background:#F3F4F5;color:#222;min-height:100vh;display:flex;flex-direction:column}.header{position:relative;min-height:112px;margin-bottom:20px;padding-right:760px}.title{font-size:26px;font-weight:800;color:${TP_BLUE}}.subtitle{margin-top:4px;font-size:15px;font-weight:700}.subtitle-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.header-sep{color:#AAA}.plan-updated{color:#555;font-size:12px;font-weight:700}.local-clock{margin-top:3px;color:#777;font-size:12px;font-weight:700}.meta{margin-top:3px;color:#777;font-size:12px}.actions{position:absolute;top:0;right:0;display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}button{font-family:inherit;border-radius:7px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap}.primary{border:1px solid ${TP_BLUE};background:${TP_BLUE};color:white}.secondary{border:1px solid #AAA;background:white;color:#333}.danger{border:1px solid #B42318;background:#B42318;color:white}.share-wrap{position:relative}.share-menu{display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:260px;background:white;border:1px solid #CCC;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000}.share-menu button{display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:11px 13px;color:#222;font-size:12px;font-weight:800;border-radius:0}.share-menu button:first-child{border-top:none}.share-menu button.share-primary{background:${TP_BLUE};color:white}.flow[draggable="true"]>.flow-header{cursor:grab}.flow.dragging{opacity:.45}.flow.dragging>.flow-header{position:relative!important;top:auto!important}.flow-controls,.area-controls{display:flex;align-items:center;gap:5px}.flow-controls.edit-only,.area-controls.edit-only{display:none}body.board-edit-mode .flow-controls.edit-only,body.board-edit-mode .area-controls.edit-only{display:flex}body.board-edit-mode .worker{cursor:default;opacity:.72}body.board-edit-mode .worker .break-chip,body.board-edit-mode .worker .magnet-menu{pointer-events:none}body.board-edit-mode .dropzone{cursor:default}body.board-edit-mode .board-operation{opacity:.45;cursor:not-allowed}.area-controls{margin-left:auto;flex:0 0 auto}.area-title{min-width:0}.area-header .compact-hint{margin-left:auto}.area-header .area-controls+.area-count{flex:0 0 auto}.flow-control,.area-control{border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.12);color:inherit;border-radius:5px;padding:3px 6px;font-size:10px;line-height:1;cursor:pointer}.area-control{border-color:#BBB;background:white;color:#555}.break-chip{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;justify-content:center;width:38px;height:38px;padding:2px;border:1px solid #B9D4EA;border-radius:6px;background:#EEF4FA;color:#0058A3;font-size:8px;font-weight:900;line-height:1;text-align:center;cursor:pointer;white-space:normal;letter-spacing:.05px}.break-chip .break-plus{font-size:15px;line-height:12px;margin-bottom:2px}.break-chip .break-word{font-size:7px;line-height:8px}.break-chip.scheduled{width:46px;background:#FFF1DE;border-color:#E6A04B;color:#9A4F00}.break-chip.active{width:46px;background:#FFF1DE;border-color:#E07A00;color:#8A3F00}.break-chip.completed{width:46px;background:#ECEFF1;border-color:#B8BEC5;color:#69727C}.break-chip.scheduled .break-word{font-size:7px;line-height:8px}.break-chip .break-time{font-size:10px;line-height:11px;font-weight:900}.break-status{position:absolute;right:6px;top:56px;width:46px;text-align:center;font-size:8px;line-height:9px;font-weight:900;color:#A15C00;white-space:nowrap}.worker.has-break{padding-right:76px}.worker.has-active-break{min-height:78px;padding-right:76px}.worker.has-active-break .break-chip{top:10px;transform:none}.worker.has-active-break .worker-time{font-size:10.5px;letter-spacing:-.08px}.worker.has-active-break .worker-absence{margin-left:5px}.break-status.active{color:#8A3F00}.flow-drop-before{box-shadow:-5px 0 0 #0058A3}.flow-drop-after{box-shadow:5px 0 0 #0058A3}.status{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;font-size:12px;color:#666}.unassigned,.leadership,.area{border-radius:8px;padding:9px}.unassigned-sticky{position:sticky;top:8px;z-index:60;margin-bottom:12px;padding:4px 0;background:#F3F4F5;border-radius:9px;box-shadow:0 8px 16px -15px rgba(0,0,0,.7);overscroll-behavior:contain}.unassigned{border:2px dashed #AAA;background:#FFF}.leadership{margin-bottom:16px;border:2px solid ${TP_BLUE};background:${TP_LIGHT_BLUE}}.board{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:14px;align-items:start}.board-column{display:flex;flex-direction:column;gap:14px;min-width:0}.flow{border:1px solid #D5D5D5;border-radius:9px;overflow:visible;background:#FFF}.flow-header{position:sticky;top:var(--flow-sticky-top,8px);z-index:45;display:flex;justify-content:space-between;align-items:center;padding:12px 13px;background:rgba(0,88,163,.93);color:white;font-size:15px;font-weight:800;border-radius:8px 8px 0 0}.flow-count,.area-count{display:inline-flex;justify-content:center;align-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:800}.flow-count{background:white;color:${TP_BLUE}}.area-count{background:#E6E6E6;color:#333}.flow-content{display:flex;flex-direction:column;gap:10px;padding:10px}.area{min-height:105px;background:#F8F8F8;border:2px dashed #C5C5C5;transition:min-height .16s ease,background .16s ease,border-color .16s ease}.area.compact-empty{min-height:46px;padding:8px 9px}.area-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:13px;font-weight:800;gap:8px}.compact-empty .area-header{margin-bottom:0}.cards{display:flex;flex-wrap:wrap;min-height:45px}.compact-empty .cards{display:none;min-height:0}.compact-empty.drop-active{min-height:82px}.compact-empty.drop-active .cards{display:flex}.compact-empty.drop-active .compact-hint{color:${TP_BLUE}}.worker{position:relative;overflow:visible;margin:4px;min-width:175px;max-width:285px;padding:8px 14px 8px 14px;background:white;border:1px solid #C8C8C8;border-radius:7px;box-shadow:0 2px 5px rgba(0,0,0,.12);cursor:grab;user-select:none}.worker.not-present{background:#ECECEC;border-color:#B9B9B9;cursor:pointer}.worker.shift-ended{background:#F4F4F4;border-color:#C9C9C9}.worker.shift-ended>.function-bar,.worker.shift-ended>.worker-name,.worker.shift-ended>.worker-time,.worker.shift-ended>.worker-absence,.worker.shift-ended>.support-note{opacity:.60}.worker.shift-ended>.magnet-menu{opacity:1!important}.shift-status{margin-top:3px;font-size:9px;font-weight:900}.shift-soon{position:absolute;right:7px;bottom:5px;margin-top:0;color:#A15C00;text-align:right}.shift-ended-label{color:#777}.support-note{margin-top:3px;color:#A55200;font-size:10px;font-weight:800}.support-flow{border:2px solid #E07A00;background:#FFF1DE;border-radius:9px;padding:9px;min-height:46px}.support-flow.compact-empty{padding:8px 9px}.support-flow .area-header{margin-bottom:7px}.support-flow.compact-empty .area-header{margin-bottom:0}.support-flow.compact-empty .cards{display:none}.support-flow.compact-empty.drop-active{min-height:82px}.support-flow.compact-empty.drop-active .cards{display:flex}.worker.not-present>.function-bar,.worker.not-present>.worker-name,.worker.not-present>.worker-time,.worker.not-present>.worker-absence{opacity:.52}.worker.menu-open{z-index:2147483645}.worker.magnet-clicked{animation:magnetPulse .18s ease-out}@keyframes magnetPulse{0%{box-shadow:0 2px 5px rgba(0,0,0,.12)}45%{box-shadow:0 0 0 4px rgba(0,88,163,.20),0 2px 5px rgba(0,0,0,.12)}100%{box-shadow:0 2px 5px rgba(0,0,0,.12)}}.function-bar{position:absolute;left:0;top:0;bottom:0;width:5px;border-radius:7px 0 0 7px}.worker-name{display:flex;flex-wrap:wrap;align-items:center;column-gap:5px;row-gap:2px;font-size:14px;font-weight:800;line-height:1.15}.worker-name>span:first-child{min-width:0}.worker-time{margin-top:4px;font-size:11px;display:flex;flex-wrap:nowrap;align-items:center;gap:0;white-space:nowrap}.worker-start{font-weight:900}.worker-arrow{font-weight:700;color:#999}.worker-end{font-weight:700;color:#666}.worker-absence{display:inline-flex;flex-wrap:nowrap;gap:3px;align-items:center;margin-left:6px;vertical-align:middle;white-space:nowrap}.absence-item{display:inline-flex;align-items:center;gap:4px}.absence-label{padding:1px 4px;border:1px solid #C85B52;border-radius:4px;background:#FFF8F7;color:#9E2F28;font-size:9px;font-weight:900}.absence-time{color:#8A4B47;font-size:9px;font-weight:700}.role-divider,.shift-divider{flex-basis:100%;display:flex;align-items:center;gap:8px;margin:7px 3px 3px;color:#777;font-size:9px;font-weight:900;letter-spacing:.45px;text-transform:uppercase}.role-divider:before,.role-divider:after,.shift-divider:before,.shift-divider:after{content:'';flex:1;height:1px;background:#D4D4D4}.badge{display:inline-flex;align-items:center;justify-content:center;height:19px;padding:0 6px;border-radius:999px;font-size:9px;font-weight:800;white-space:nowrap}.drop-active{border-color:${TP_BLUE}!important;background:rgba(0,88,163,.10)!important}.magnet-menu{display:none;position:fixed;z-index:2147483646;min-width:180px;background:white;border:1px solid #BBB;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;opacity:1}.magnet-menu button{display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:9px 11px;color:#222;font-size:11px;font-weight:800;border-radius:0}.compact-hint{color:#999;font-size:10px;font-weight:800}.unassigned-show{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;border:1px solid #BBB;background:#FFF;color:#555;border-radius:5px;padding:3px 6px;font-size:10px;line-height:1;font-weight:800;letter-spacing:0}.board{margin-bottom:14px}.handover-notes{border:1px solid #D6C58A;border-radius:9px;background:#FFF9E8;padding:12px}.handover-notes-title{font-size:13px;font-weight:900;color:#4A4330;margin-bottom:8px;letter-spacing:.2px}.handover-notes textarea{display:block;width:100%;min-height:110px;resize:vertical;border:1px solid #D8D0B5;border-radius:7px;background:#FFFDF7;padding:10px 11px;color:#333;font:inherit;font-size:12px;line-height:1.4;outline:none}.handover-notes textarea:focus{border-color:#B7A35D;box-shadow:0 0 0 2px rgba(183,163,93,.14)}.handover-notes-hint{margin-top:6px;color:#8A8062;font-size:9px;font-weight:700}.handover-reminder{display:none;position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.28);align-items:center;justify-content:center;padding:20px}.handover-reminder.show{display:flex}.handover-reminder-card{width:min(360px,100%);background:#FFF;border-radius:10px;box-shadow:0 12px 35px rgba(0,0,0,.28);padding:20px}.handover-reminder-title{font-size:18px;font-weight:900;margin-bottom:18px}.handover-reminder-actions{display:flex;justify-content:flex-end;gap:9px}@media(max-width:1100px){.header{padding-right:0;padding-top:110px}.actions{left:0;right:0;justify-content:flex-start}.board{grid-template-columns:repeat(2,minmax(280px,1fr))}}@media(max-width:760px){.board{grid-template-columns:1fr}}@media(max-width:620px){body{padding:16px}.header{padding-top:165px}}
    @media print{@page{size:A4 landscape;margin:8mm}html,body{background:white!important}body{padding:0!important;font-size:10px}.header{min-height:auto!important;margin-bottom:8px!important;padding:0!important}.title{font-size:20px!important}.subtitle{font-size:12px!important}.plan-updated,.local-clock,.meta{font-size:9px!important}.actions,.status,.handover-reminder{display:none!important}.unassigned-sticky{position:static!important;max-height:none!important;overflow:visible!important;margin-bottom:7px!important;padding:0!important;background:transparent!important;box-shadow:none!important}.unassigned,.leadership,.area{break-inside:avoid;border-radius:5px!important;padding:5px!important}.leadership{margin-bottom:7px!important}.board{display:grid!important;grid-template-columns:repeat(var(--print-columns,3),minmax(0,1fr))!important;gap:7px!important;align-items:start}.board-column{display:contents!important}.support-flow{grid-column:auto!important}.handover-notes{break-inside:avoid!important;padding:7px!important}.handover-notes-title{font-size:10px!important;margin-bottom:5px!important}.handover-notes textarea{min-height:70px!important;padding:6px!important;font-size:9px!important;border-width:1px!important}.handover-notes-hint{display:none!important}.flow{break-inside:avoid;border-radius:5px!important}.flow-header{position:static!important;padding:7px 8px!important;font-size:11px!important;border-radius:4px 4px 0 0!important}.flow-content{gap:5px!important;padding:5px!important}.area{min-height:0!important;border-width:1px!important}.area-header{margin-bottom:4px!important;font-size:10px!important}.cards{min-height:0!important}.worker{break-inside:avoid;margin:2px!important;min-width:0!important;max-width:none!important;padding:5px 6px 5px 10px!important;border-radius:5px!important;box-shadow:none!important}.worker-name{font-size:10px!important;gap:3px!important}.worker-time{margin-top:2px!important;font-size:9px!important}.worker-absence{margin-top:2px!important}.badge{height:15px!important;padding:0 4px!important;font-size:7px!important}.role-divider,.shift-divider{margin:4px 2px 2px!important;font-size:7px!important}.area-count,.flow-count{min-width:18px!important;height:18px!important;font-size:8px!important}.print-hidden{display:none!important}.compact-hint,.magnet-menu,#hideUnassigned,#showUnassigned{display:none!important}.compact-empty .cards{display:flex!important}.compact-empty{min-height:0!important}.function-bar{width:4px!important}.break-chip{display:none!important}}
    </style>
    </head>
    <body>
    <script id="tp-state" type="application/json">${stateJSON}</script>
    <div class="header"><div><div class="title">Daily Board Plan</div>${data.snapshotCapturedAt ? `<div class="board-snapshot-stamp" style="margin-top:5px;color:#666;font-size:13px;font-weight:500;">Snapshot · ${escapeHTML(new Intl.DateTimeFormat("en-GB", {dateStyle:"medium",timeStyle:"short"}).format(new Date(data.snapshotCapturedAt)))}</div>` : ""}<div class="subtitle subtitle-line"><span id="dateLabel"></span><span class="header-sep">&middot;</span><span class="plan-updated" id="planUpdated"></span></div><div class="local-clock" id="localClock"></div><div class="meta">Department ${escapeHTML(data.department)}</div></div><div class="actions"><div style="position:relative"><button class="secondary" id="basicPlanButton" data-board-operation="1" style="border-color:${TP_BLUE};color:${TP_BLUE}">Create Basic Plan</button><div id="basicPlanMenu" style="display:none;position:absolute;right:0;top:calc(100% + 5px);min-width:245px;background:white;border:1px solid #CCC;border-radius:7px;box-shadow:0 5px 15px rgba(0,0,0,.18);overflow:hidden;z-index:100000"><button class="basic-plan-choice" data-mode="morning" style="display:block;width:100%;text-align:left;border:none;background:white;padding:10px 13px;color:#222"><strong>Morning Default</strong><span style="display:block;margin-top:2px;font-size:10px;color:#777">Morning team only - Unassigned coworkers</span></button><button class="basic-plan-choice" data-mode="evening" style="display:block;width:100%;text-align:left;border:none;border-top:1px solid #EEE;background:white;padding:10px 13px;color:#222"><strong>Evening Default</strong><span style="display:block;margin-top:2px;font-size:10px;color:#777">Evening team only - Unassigned coworkers</span></button></div></div><button class="secondary" id="externalButton" data-board-operation="1">+ External Help</button><button class="secondary" id="kraftButton" data-board-operation="1">+ Quick KRAFTSAMLA</button><button class="secondary" id="editFlowsButton">Edit Flows</button><button class="secondary" id="addFlowButton" style="display:none">+ Add Flow</button><div class="share-wrap"><button class="primary" id="shareButton" data-board-operation="1">Save Plan</button><div class="share-menu" id="shareMenu"><button data-share="quick" class="share-primary">Share Plan for HANDOVER</button><button data-share="pdf">Export PDF</button></div></div><button class="danger" id="resetButton" data-board-operation="1">Reset Board</button></div></div>
    <div class="status"><span id="coworkerCount"></span><span id="lastChange"></span></div>
    <div id="unassignedWrapper"><div id="unassigned"></div></div><div id="leadership"></div><div id="board" class="board"></div><div id="handoverReminder" class="handover-reminder"><div class="handover-reminder-card"><div class="handover-reminder-title">Share handover now?</div><div class="handover-reminder-actions"><button class="secondary" id="handoverNotNow">Not now</button><button class="primary" id="handoverSaveNow">Save Plan</button></div></div></div>
    <script>
    const DATA=${dataJSON};
    let state={assignments:{},notPresent:{},supportDestinations:{},supportTimes:{},breaks:{},boardFlows:null,handoverNotes:'',lastUpdated:null};
    try{state={...state,...JSON.parse(document.getElementById('tp-state').textContent||'{}')}}catch{}
    let assignments=state.assignments||{};
    let notPresent=state.notPresent||{};
    let supportDestinations=state.supportDestinations||{};
    let supportTimes=state.supportTimes||{};
    let breaks=state.breaks||{};
    let boardFlows=Array.isArray(state.boardFlows)?state.boardFlows.map(g=>({id:g.id,group:g.group,areas:(g.areas||[]).map(a=>({...a}))})):DATA.areas.map(g=>({id:g.id,group:g.group,areas:(g.areas||[]).map(a=>({...a}))}));
    let handoverNotes=typeof state.handoverNotes==='string'?state.handoverNotes:'';
    
    let handoverReminderShown=false;
    let externalWorkers=Array.isArray(state.externalWorkers)?state.externalWorkers:[];
    let workerOverrides=state.workerOverrides||{};
    let lastUpdated=state.lastUpdated||new Date().toISOString();
    const ORIGINAL_WORKERS=new Map(DATA.workers.map(w=>[w.key,{start:w.start,end:w.end,effectiveStart:w.effectiveStart}]));
    externalWorkers.forEach(w=>{if(w&&w.key&&!DATA.workers.some(x=>x.key===w.key))DATA.workers.push(w)});
    Object.entries(workerOverrides).forEach(([key,o])=>{const w=DATA.workers.find(x=>x.key===key);if(w&&o){if(o.start)w.start=o.start;if(o.end)w.end=o.end;if(o.effectiveStart)w.effectiveStart=o.effectiveStart}});
    Object.entries(assignments).forEach(([key,dest])=>{if(String(dest).startsWith('pup-'))assignments[key]='unassigned'});
    let draggedKey=null;
    let draggedFlowId=null;
    let unassignedCollapsed=false;
    let boardEditMode=false;
    let dirty=false;
    function setDirty(value=true){dirty=value;if(value)queueBoardRecoverySave()}
    function queueBoardRecoverySave(){
      if(!window.__tpBoardRecoveryKey)return;
      clearTimeout(window.__tpBoardRecoveryTimer);
      window.__tpBoardRecoveryTimer=setTimeout(saveBoardRecovery,100);
    }
    function saveBoardRecovery(){
      if(!window.__tpBoardRecoveryKey)return;
      try{sessionStorage.setItem(window.__tpBoardRecoveryKey,currentPortableHTML())}
      catch(err){console.warn('Board recovery save failed:',err)}
    }
    function syncExternalWorkers(){externalWorkers=DATA.workers.filter(w=>w.isExternal).map(w=>({...w}))}
    function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
    function contrast(hex){const c=String(hex||'#666666').replace('#','');const r=parseInt(c.substring(0,2),16),g=parseInt(c.substring(2,4),16),b=parseInt(c.substring(4,6),16);return((r*299+g*587+b*114)/1000)>155?'#222':'#FFF'}
    function assignment(w){return assignments[w.key]||'unassigned'}
    function workersFor(area){return DATA.workers.filter(w=>assignment(w)===area)}
    function timeMinutes(v){const p=String(v||'00:00').split(':').map(Number);return((p[0]||0)*60)+(p[1]||0)}
    function roleGroup(w){if(w.isExternal)return{id:'external-help',label:'EXTERNAL HELP'};const labels=new Set((w.badges||[]).map(b=>b.label));if(labels.has('COORD'))return{id:'coordinators',label:'COORDINATORS'};if(labels.has('OA'))return{id:'order-auditors',label:'ORDER AUDITORS'};if(labels.has('FLT'))return{id:'forklift-drivers',label:'FORKLIFT DRIVERS'};return{id:'order-pickers',label:'ORDER PICKERS'}}
    function sortWorkers(ws){return[...ws].sort((a,b)=>timeMinutes(a.effectiveStart||a.start)-timeMinutes(b.effectiveStart||b.start)||timeMinutes(a.start)-timeMinutes(b.start)||a.name.localeCompare(b.name))}
    function groupedUnassigned(ws){const defs=[['coordinators','COORDINATORS'],['order-auditors','ORDER AUDITORS'],['forklift-drivers','FORKLIFT DRIVERS'],['order-pickers','ORDER PICKERS'],['external-help','EXTERNAL HELP']];return defs.map(([id,label])=>({id,label,workers:sortWorkers(ws.filter(w=>roleGroup(w).id===id))})).filter(g=>g.workers.length)}
    function isLB(w){const labels=(w.badges||[]).flatMap(b=>[b&&b.label,b&&b.title]).filter(Boolean).map(v=>String(v).trim().toUpperCase());if(labels.some(v=>v==='LB'||v.includes('LOADING BAY')))return true;const names=(w.functionNames||[]).map(n=>String(n||'').trim().toLowerCase());if(names.some(n=>n==='lb'||n.includes('loading bay')))return true;return String(w.function||w.role||'').toLowerCase().includes('loading bay')}
    function existingAreaIds(){return new Set(boardFlows.flatMap(g=>(g.areas||[]).map(a=>a.id)))}
    function normalizeAssignments(){const valid=existingAreaIds();let changed=false;Object.keys(assignments).forEach(key=>{const dest=assignments[key];if(dest&&dest!=='unassigned'&&dest!=='leadership'&&dest!=='support'&&!valid.has(dest)){assignments[key]='unassigned';changed=true}});if(changed)unassignedCollapsed=false;return changed}
    function areaByMeaning(flow,meaning){const q=String(meaning||'').toLowerCase();const suffix={'floor':'-floor','mh':'-mh','reachtruck':'-reachtruck','loading & checking':'-loading-checking'}[q]||'';return(flow?.areas||[]).find(a=>String(a.name||'').toLowerCase()===q||(suffix&&String(a.id||'').toLowerCase().endsWith(suffix)))||null}
    function applyBasicPlan(mode){normalizeAssignments();const evening=mode==='evening';const targetFlow=boardFlows[evening?1:0];if(!targetFlow){alert((evening?'Evening':'Morning')+' Basic Plan needs '+(evening?'Flow 2':'Flow 1')+' to exist.');return}const eligible=sortWorkers(DATA.workers.filter(w=>!w.isExternal&&!notPresent[w.key]&&assignment(w)==='unassigned'&&(isLB(w)||((timeMinutes(w.effectiveStart||w.start)>=660)===evening))));if(!eligible.length)return;const floor=areaByMeaning(targetFlow,'Floor'),mh=areaByMeaning(targetFlow,'MH');const lcdFlow=boardFlows.find(g=>g.id==='lcd'||String(g.group||'').trim().toLowerCase()==='lcd');const loading=lcdFlow&&areaByMeaning(lcdFlow,'Loading & Checking');const ccFlow=boardFlows.find(g=>g.id==='click-collect'||String(g.group).toLowerCase().includes('click'));const fsFlow=boardFlows.find(g=>g.id==='fullserve'||String(g.group).toLowerCase().includes('fullserve'));const forkliftDest=evening?(fsFlow&&areaByMeaning(fsFlow,'VULPICKS')):(ccFlow&&areaByMeaning(ccFlow,'Reachtruck'));const pickers=[];eligible.forEach(w=>{const g=roleGroup(w);let dest=null;if(isLB(w)){dest=loading}else if(g.id==='coordinators'||g.id==='order-auditors'){dest={id:'leadership'}}else if(g.id==='forklift-drivers'){dest=forkliftDest}else pickers.push(w);if(dest)assignments[w.key]=dest.id});const mhCount=pickers.length>=8?2:(pickers.length?1:0);pickers.forEach((w,i)=>{const dest=i<mhCount?mh:floor;if(dest)assignments[w.key]=dest.id});if(!workersFor('unassigned').length)unassignedCollapsed=true;setDirty();last((evening?'Evening':'Morning')+' basic plan created');render()}
    function badgesHTML(w){return(w.badges||[]).map(b=>{const c=b.color||'#666';return '<span class="badge" title="'+esc(b.title)+'" style="background:'+c+';border:1px solid '+c+';color:'+contrast(c)+'">'+esc(b.label)+'</span>'}).join('')}
    function absenceHTML(w){const notes=(w.allDayAbsenceNotes||[]).map(n=>'<div style="margin-top:3px;color:#6A5B38;font-size:9px;font-weight:700">ⓘ Absence: '+esc(n)+' · All day</div>').join('');if(!(w.absences||[]).length)return notes;return '<span class="worker-absence">'+w.absences.map(a=>'<span class="absence-item"><span class="absence-label">ABS</span><span class="absence-time">'+esc(a.start)+'&ndash;'+esc(a.end)+'</span></span>').join('')+'</span>'+notes}
    function formatClock(d,withSeconds=false){return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',...(withSeconds?{second:'2-digit'}:{})})}
    function refreshHeaderTimes(){const updated=document.getElementById('planUpdated');if(updated){const d=new Date(lastUpdated);updated.textContent='Last updated plan: '+(Number.isNaN(d.getTime())?'--:--':formatClock(d))}const clock=document.getElementById('localClock');if(clock)clock.textContent='Local time: '+formatClock(new Date(),true)}
    function touchPlan(){lastUpdated=new Date().toISOString();refreshHeaderTimes()}
    function last(text){document.getElementById('lastChange').textContent=text;touchPlan()}
    function localISODate(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
    function currentMinutes(){const now=new Date();return now.getHours()*60+now.getMinutes()}
    function hasActiveAbsence(w,m=currentMinutes()){return (w.absences||[]).some(a=>m>=timeMinutes(a.start)&&m<timeMinutes(a.end))}
    function shiftStatus(w){if(DATA.date!==localISODate())return null;const m=currentMinutes(),end=timeMinutes(w.end);if(hasActiveAbsence(w,m))return null;const bs=breakStatus(w);if(bs&&bs.active)return null;if(end-m<=45&&end-m>=0)return{soon:true,text:'OFF SOON'};if(m>=end)return{ended:true,text:'SHIFT ENDED'};return null}
    function breakStatus(w){if(DATA.date!==localISODate()||notPresent[w.key]||hasActiveAbsence(w))return null;const b=breaks[w.key];if(!b||b.dismissed)return null;const m=currentMinutes(),start=timeMinutes(b.start),end=timeMinutes(b.end);if(m>=start-1&&m<end+5)return{active:true,text:'ON BREAK'};return null}
    function breakIsPending(w){const b=breaks[w.key];if(!b||b.dismissed||DATA.date!==localISODate())return !!(b&&!b.dismissed);return currentMinutes()<timeMinutes(b.start)-1}
    function breakIsFinished(w){const b=breaks[w.key];if(!b||b.dismissed)return true;if(DATA.date!==localISODate())return false;return currentMinutes()>=timeMinutes(b.end)+5}
    function isWorkerActive(w){return !notPresent[w.key]&&!((shiftStatus(w)||{}).ended)}
    function addMinutesToClock(start,mins){let total=timeMinutes(start)+Number(mins||0);total=Math.max(0,Math.min(1439,total));return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0')}
    function normalizeBreakClock(input){
      const value=String(input??'').trim().replace(/[.,]/g,':');
      let hours,minutes;
      if(/^\d{1,2}$/.test(value)){hours=Number(value);minutes=0}
      else if(/^\d{3,4}$/.test(value)){hours=Number(value.slice(0,-2));minutes=Number(value.slice(-2))}
      else if(/^\d{1,2}:\d{1,2}$/.test(value)){const parts=value.split(':');hours=Number(parts[0]);minutes=Number(parts[1])}
      else return null;
      if(hours>23||minutes>59)return null;
      return String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');
    }
    function editBreak(key,w){const old=breaks[key]||{};const startRaw=prompt('Break start (e.g. 9:30, 930, 11):',old.start||'12:00');if(startRaw===null)return false;const start=normalizeBreakClock(startRaw);if(!start){alert('Please enter a valid break time (e.g. 09:30, 930, or 11).');return false}const durationRaw=prompt('Break duration in minutes:',old.start&&old.end?String(timeMinutes(old.end)-timeMinutes(old.start)):'30');if(durationRaw===null)return false;const duration=Number(durationRaw);if(!Number.isFinite(duration)||duration<=0||duration>180){alert('Please use a break duration between 1 and 180 minutes.');return false}const end=addMinutesToClock(start,duration);if(timeMinutes(end)<=timeMinutes(start)){alert('The break must finish on the same day.');return false}breaks[key]={start,end,dismissed:false};return true}
    function workerHTML(w){const np=!!notPresent[w.key];const adjusted=!!workerOverrides[w.key]&&!w.isExternal;const bs=np?null:breakStatus(w);const ss=np||bs&&bs.active?null:shiftStatus(w);const storedBreak=breaks[w.key]||null;const finishedBreak=!!storedBreak&&breakIsFinished(w);const canShowBreakChip=!np&&!!storedBreak;const showActiveBreak=canShowBreakChip&&!!(bs&&bs.active);const completedBreak=canShowBreakChip&&!showActiveBreak&&(finishedBreak||storedBreak.dismissed);const breakChip=canShowBreakChip?(showActiveBreak?'<span class="break-chip active" data-break-shortcut="1" title="Edit break"><span class="break-word">BREAK</span><span class="break-time">'+esc(storedBreak.start)+'</span></span><span class="break-status active">ON BREAK</span>':'<span class="break-chip '+(completedBreak?'completed':'scheduled')+'" data-break-shortcut="1" title="Edit break"><span class="break-word">BREAK</span><span class="break-time">'+esc(storedBreak.start)+'</span></span>'):'';const hasEditableBreak=!!storedBreak;const support=assignment(w)==='support'?(supportDestinations[w.key]||'Other department'):'';const supportTime=support?(supportTimes[w.key]||null):null;const supportLabel=support?(support+(supportTime?' · '+supportTime.start+'-'+supportTime.end:'')):'';return '<div class="worker'+(np?' not-present':'')+(ss&&ss.ended?' shift-ended':'')+(canShowBreakChip?' has-break':'')+(bs&&bs.active?' has-active-break':'')+'" draggable="'+(!np&&!boardEditMode)+'" data-worker-key="'+esc(w.key)+'"><span class="function-bar" style="background:'+(np?'#999':w.functionBar)+'"></span><div class="worker-name"><span>'+esc(w.name)+'</span>'+(w.isExternal?'<span class="badge" style="background:#666;color:#fff">EXT</span>':badgesHTML(w))+(adjusted?'<span class="badge" style="background:#7A5AF8;color:#fff" title="Board time adjusted manually">TIME</span>':'')+(np?'<span class="badge" style="background:#666;color:#fff">ABSENCE</span>':'')+'</div><div class="worker-time"><span class="worker-start">'+esc(w.start)+'</span><span class="worker-arrow"> &rarr; </span><span class="worker-end">'+esc(w.end)+'</span>'+(!w.isExternal?absenceHTML(w):'')+'</div>'+(w.isExternal?'<div style="margin-top:3px;color:#777;font-size:10px;font-weight:700">External help</div>':'')+breakChip+(support?'<div class="support-note">SUPPORT · '+esc(supportLabel)+'</div>':'')+(ss?'<div class="shift-status '+(ss.ended?'shift-ended-label':'shift-soon')+'">'+ss.text+'</div>':'')+'<div class="magnet-menu"><button data-action="presence">'+(np?'Mark as available':'Mark as absent')+'</button><button data-action="break">'+(hasEditableBreak?'Edit break':'Set break')+'</button>'+(bs&&bs.active?'<button data-action="break-available">Mark as available from break</button>':'')+(hasEditableBreak?'<button data-action="remove-break">Remove break</button>':'')+'<button data-action="time">Edit board time</button><button data-action="support">Support other department</button>'+(support?'<button data-action="edit-support">Edit support details</button>':'')+(adjusted?'<button data-action="restore-time">Restore TimePlan time</button>':'')+(w.isExternal?'<button data-action="edit">Edit external help</button><button data-action="remove" style="color:#A12622">Remove external help</button>':'')+'</div></div>'}
    function cardsHTML(ws,id){if(id==='unassigned')return groupedUnassigned(ws).map(g=>'<div class="role-divider"><span>'+esc(g.label)+' &middot; '+g.workers.filter(isWorkerActive).length+'</span></div>'+g.workers.map(workerHTML).join('')).join('');let eveningAdded=false;return sortWorkers(ws).map(w=>{const evening=timeMinutes(w.effectiveStart||w.start)>=660;let d='';if(!eveningAdded&&evening){d='<div class="shift-divider"><span>Evening Team</span></div>';eveningAdded=true}return d+workerHTML(w)}).join('')}
    function makeZone(id,name,extra='area',editable=false){const ws=workersFor(id);const activeCount=ws.filter(isWorkerActive).length;if(id==='unassigned'&&unassignedCollapsed)return '<div class="'+extra+' dropzone unassigned-compact" data-area-id="'+id+'"><div class="area-header" style="margin-bottom:0"><span>'+esc(name)+' <span class="area-count">'+activeCount+'</span></span><span class="compact-hint unassigned-show">SHOW</span></div></div>';const compact=!ws.length&&id!=='unassigned';const controls=editable?'<span class="area-controls edit-only"><button class="area-control" data-area-action="rename" data-area-id="'+esc(id)+'" title="Rename area">EDIT</button><button class="area-control" data-area-action="delete" data-area-id="'+esc(id)+'" title="Delete area">DELETE</button></span>':'';const unassignedHide=id==='unassigned'?'<button class="area-control unassigned-hide" data-unassigned-hide="1" title="Collapse unassigned">HIDE</button>':'';return '<div class="'+extra+' dropzone'+(compact?' compact-empty':'')+'" data-area-id="'+id+'"><div class="area-header"><span class="area-title">'+esc(name)+'</span>'+(compact?'<span class="compact-hint">Drop here</span>':'')+controls+'<span class="area-count">'+activeCount+'</span>'+unassignedHide+'</div><div class="cards">'+cardsHTML(ws,id)+'</div></div>'}
    function render(){normalizeAssignments();document.body.classList.toggle('board-edit-mode',boardEditMode);document.body.classList.toggle('board-edit-mode',boardEditMode);document.getElementById('dateLabel').textContent=DATA.formattedDate;refreshHeaderTimes();const planned=DATA.workers.length;const available=DATA.workers.filter(isWorkerActive).length;const np=DATA.workers.filter(w=>notPresent[w.key]).length;document.getElementById('coworkerCount').textContent=planned+' planned today · '+available+' available'+(np?' · '+np+' absence':'');const uw=document.getElementById('unassignedWrapper');if(!workersFor('unassigned').length)unassignedCollapsed=true;uw.className='unassigned-sticky';uw.style.maxHeight=unassignedCollapsed?'none':'38vh';uw.style.overflowY=unassignedCollapsed?'visible':'auto';document.getElementById('unassigned').innerHTML=makeZone('unassigned','UNASSIGNED','unassigned');document.getElementById('leadership').innerHTML=makeZone('leadership','ORDER AUDITOR - COORDINATOR','leadership');const supportWorkers=workersFor('support');const supportCount=supportWorkers.filter(isWorkerActive).length;const supportHTML=supportWorkers.length?'<section id="support" class="support-flow dropzone" data-area-id="support"><div class="area-header"><span>SUPPORT OTHER DEPARTMENTS</span><span class="area-count">'+supportCount+'</span></div><div class="cards">'+supportWorkers.map(workerHTML).join('')+'</div></section>':'';const flowHTML=g=>'<section class="flow" draggable="true" data-flow-id="'+esc(g.id)+'"><div class="flow-header"><span>'+esc(g.group)+'</span><span class="flow-controls edit-only"><button class="flow-control" data-flow-action="rename" data-flow-id="'+esc(g.id)+'">EDIT</button><button class="flow-control" data-flow-action="add-area" data-flow-id="'+esc(g.id)+'">+ AREA</button><button class="flow-control" data-flow-action="delete" data-flow-id="'+esc(g.id)+'">DELETE</button><span class="flow-count">'+g.areas.reduce((t,a)=>t+workersFor(a.id).filter(isWorkerActive).length,0)+'</span></span></div><div class="flow-content">'+g.areas.map(a=>makeZone(a.id,a.name,'area',true)).join('')+'</div></section>';const board=document.getElementById('board');const width=window.innerWidth;const columnCount=width<=760?1:(width<=1100?2:3);board.innerHTML=Array.from({length:columnCount},()=>'<div class="board-column"></div>').join('');const boardColumns=[...board.querySelectorAll('.board-column')];const blocks=boardFlows.map(g=>({html:flowHTML(g),kind:'flow'}));if(supportHTML)blocks.push({html:supportHTML,kind:'support'});blocks.forEach((block,index)=>{let target;if(index<columnCount&&block.kind==='flow'){target=boardColumns[index]}else{target=boardColumns.reduce((best,col)=>col.scrollHeight<best.scrollHeight?col:best,boardColumns[0])}target.insertAdjacentHTML('beforeend',block.html)});const notesColumn=boardColumns[boardColumns.length-1];if(notesColumn)notesColumn.insertAdjacentHTML('beforeend','<section class="handover-notes"><div class="handover-notes-title">HANDOVER NOTES</div><textarea id="handoverNotesInput" maxlength="2000" placeholder="Write notes for the next team...">'+esc(handoverNotes)+'</textarea><div class="handover-notes-hint">Saved with Share Plan for HANDOVER</div></section>');bind();const notesInput=document.getElementById('handoverNotesInput');if(notesInput)notesInput.addEventListener('input',()=>{handoverNotes=notesInput.value;setDirty()});updateSticky()}
    function updateSticky(){const w=document.getElementById('unassignedWrapper');document.documentElement.style.setProperty('--flow-sticky-top',(Math.ceil(w.getBoundingClientRect().height)+16)+'px')}
    function positionMenu(el,m){if(!el||!m||m.style.display!=='block')return;const r=el.getBoundingClientRect();if(r.bottom<0||r.top>window.innerHeight){m.style.display='none';el.classList.remove('menu-open');return}const mr=m.getBoundingClientRect();let left=Math.min(Math.max(8,r.left),window.innerWidth-mr.width-8);let top=r.bottom+5;if(top+mr.height>window.innerHeight-8)top=Math.max(8,r.top-mr.height-5);m.style.left=left+'px';m.style.top=top+'px'}
    function repositionOpenMenu(){const el=document.querySelector('.worker.menu-open');if(el)positionMenu(el,el.querySelector('.magnet-menu'))}
    function askSupportDetails(key,w){const destination=prompt('Department / team to support:',supportDestinations[key]||'Replenishment');if(!destination||!destination.trim())return false;const existing=supportTimes[key]||{};const start=prompt('Support from (HH:MM):',existing.start||w.start);if(start===null)return false;const end=prompt('Support until (HH:MM):',existing.end||w.end);if(end===null)return false;if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start)){alert('Please use valid HH:MM support times, with end later than start.');return false}supportDestinations[key]=destination.trim();supportTimes[key]={start,end};return true}
    function uniqueId(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6)}
    function findFlow(id){return boardFlows.find(g=>g.id===id)}
    function findAreaLocation(id){for(const flow of boardFlows){const index=flow.areas.findIndex(a=>a.id===id);if(index>=0)return{flow,index,area:flow.areas[index]}}return null}
    function addFlow(){const name=prompt('New flow name:');if(!name||!name.trim())return;boardFlows.push({id:uniqueId('flow'),group:name.trim(),areas:[]});setDirty();last('Flow added');render()}
    function renameFlow(id){const flow=findFlow(id);if(!flow)return;const name=prompt('Flow name:',flow.group);if(!name||!name.trim())return;flow.group=name.trim();setDirty();last('Flow renamed');render()}
    function addArea(id){const flow=findFlow(id);if(!flow)return;const name=prompt('New area name:');if(!name||!name.trim())return;flow.areas.push({id:uniqueId('area'),name:name.trim()});setDirty();last('Area added to '+flow.group);render()}
    function deleteFlow(id){const flow=findFlow(id);if(!flow||!confirm('Are you sure you want to delete '+flow.group+' flow?'))return;const ids=new Set(flow.areas.map(a=>a.id));Object.keys(assignments).forEach(key=>{if(ids.has(assignments[key]))assignments[key]='unassigned'});boardFlows=boardFlows.filter(g=>g.id!==id);unassignedCollapsed=false;setDirty();last('Flow deleted');render()}
    function renameArea(id){const loc=findAreaLocation(id);if(!loc)return;const name=prompt('Area name:',loc.area.name);if(!name||!name.trim())return;loc.area.name=name.trim();setDirty();last('Area renamed');render()}
    function deleteArea(id){const loc=findAreaLocation(id);if(!loc||!confirm('Are you sure you want to delete '+loc.area.name+' area?'))return;Object.keys(assignments).forEach(key=>{if(assignments[key]===id)assignments[key]='unassigned'});loc.flow.areas.splice(loc.index,1);unassignedCollapsed=false;setDirty();last('Area deleted');render()}
    function bind(){const ua=document.getElementById('unassigned');if(ua)ua.onclick=e=>{if(e.target.closest('.worker')||e.target.closest('button'))return;if(unassignedCollapsed){e.stopPropagation();unassignedCollapsed=false;render()}};const hideUnassigned=document.querySelector('[data-unassigned-hide]');if(hideUnassigned)hideUnassigned.onclick=e=>{e.preventDefault();e.stopPropagation();unassignedCollapsed=true;render()};document.querySelectorAll('[data-flow-action]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();const id=btn.dataset.flowId;if(btn.dataset.flowAction==='rename')renameFlow(id);else if(btn.dataset.flowAction==='add-area')addArea(id);else if(btn.dataset.flowAction==='delete')deleteFlow(id)});document.querySelectorAll('[data-area-action]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();if(btn.dataset.areaAction==='rename')renameArea(btn.dataset.areaId);else if(btn.dataset.areaAction==='delete')deleteArea(btn.dataset.areaId)});document.querySelectorAll('.flow[draggable="true"]').forEach(flow=>{flow.addEventListener('dragstart',e=>{if(e.target.closest('.worker')||e.target.closest('button')){e.preventDefault();return}draggedFlowId=flow.dataset.flowId;flow.classList.add('dragging');e.dataTransfer.setData('application/x-timeplan-flow',draggedFlowId);e.dataTransfer.effectAllowed='move'});flow.addEventListener('dragend',()=>{draggedFlowId=null;flow.classList.remove('dragging');document.querySelectorAll('.flow').forEach(f=>f.classList.remove('flow-drop-before','flow-drop-after'))});flow.addEventListener('dragover',e=>{if(!draggedFlowId||draggedFlowId===flow.dataset.flowId)return;e.preventDefault();const before=e.clientX<flow.getBoundingClientRect().left+flow.getBoundingClientRect().width/2;flow.classList.toggle('flow-drop-before',before);flow.classList.toggle('flow-drop-after',!before)});flow.addEventListener('dragleave',()=>flow.classList.remove('flow-drop-before','flow-drop-after'));flow.addEventListener('drop',e=>{if(!draggedFlowId||draggedFlowId===flow.dataset.flowId)return;e.preventDefault();e.stopPropagation();const from=boardFlows.findIndex(g=>g.id===draggedFlowId),to=boardFlows.findIndex(g=>g.id===flow.dataset.flowId);if(from<0||to<0)return;const before=e.clientX<flow.getBoundingClientRect().left+flow.getBoundingClientRect().width/2;const moved=boardFlows.splice(from,1)[0];let target=boardFlows.findIndex(g=>g.id===flow.dataset.flowId);if(!before)target++;boardFlows.splice(target,0,moved);setDirty();last('Flow order updated');render()})});document.querySelectorAll('.worker').forEach(el=>{const key=el.dataset.workerKey;if(boardEditMode){el.setAttribute('draggable','false');return;}const shortcut=el.querySelector('[data-break-shortcut]');if(shortcut)shortcut.onclick=e=>{e.preventDefault();e.stopPropagation();const w=DATA.workers.find(x=>x.key===key);if(w&&editBreak(key,w)){setDirty();last('Break updated');render()}};el.addEventListener('click',e=>{if(e.target.closest('.magnet-menu button')||e.target.closest('[data-break-shortcut]'))return;e.stopPropagation();el.classList.remove('magnet-clicked');void el.offsetWidth;el.classList.add('magnet-clicked');setTimeout(()=>el.classList.remove('magnet-clicked'),190);document.querySelectorAll('.worker.menu-open').forEach(w=>{if(w!==el)w.classList.remove('menu-open')});document.querySelectorAll('.magnet-menu').forEach(m=>{if(m!==el.querySelector('.magnet-menu'))m.style.display='none'});const m=el.querySelector('.magnet-menu');const opening=m.style.display!=='block';if(!opening){m.style.display='none';el.classList.remove('menu-open');return}el.classList.add('menu-open');m.style.display='block';positionMenu(el,m)});if(el.getAttribute('draggable')==='true'){el.addEventListener('dragstart',e=>{e.stopPropagation();draggedKey=key;e.dataTransfer.setData('text/plain',key);el.style.opacity='.45'});el.addEventListener('dragend',()=>{draggedKey=null;el.style.opacity=''})}el.querySelectorAll('.magnet-menu button').forEach(btn=>btn.onclick=e=>{e.stopPropagation();const w=DATA.workers.find(x=>x.key===key);if(!w)return;if(btn.dataset.action==='break'){if(!editBreak(key,w))return;setDirty();last('Break updated');render()}else if(btn.dataset.action==='break-available'){if(breaks[key])breaks[key].dismissed=true;setDirty();last('Coworker marked available from break');render()}else if(btn.dataset.action==='remove-break'){delete breaks[key];setDirty();last('Break removed');render()}else if(btn.dataset.action==='support'){if(!askSupportDetails(key,w))return;assignments[key]='support';setDirty();last('Assigned to support '+supportDestinations[key]);render()}else if(btn.dataset.action==='edit-support'){if(!askSupportDetails(key,w))return;setDirty();last('Support details updated');render()}else if(btn.dataset.action==='presence'){notPresent[key]=!notPresent[key];if(notPresent[key])assignments[key]='unassigned';else delete notPresent[key];setDirty();last(notPresent[key]?'Marked as absent':'Marked as available');render()}else if(btn.dataset.action==='time'){const start=prompt('Board shift start (HH:MM):',w.start);if(start===null)return;const end=prompt('Board shift end (HH:MM):',w.end);if(end===null)return;if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');w.start=start;w.end=end;w.effectiveStart=start;if(w.isExternal)syncExternalWorkers();else workerOverrides[key]={start,end,effectiveStart:start};setDirty();last('Board time adjusted');render()}else if(btn.dataset.action==='restore-time'&&!w.isExternal){const o=ORIGINAL_WORKERS.get(key);if(o){w.start=o.start;w.end=o.end;w.effectiveStart=o.effectiveStart;delete workerOverrides[key];setDirty();last('TimePlan time restored');render()}}else if(btn.dataset.action==='edit'&&w.isExternal){const name=prompt('External coworker name:',w.name);if(!name)return;const start=prompt('Shift start (HH:MM):',w.start);const end=prompt('Shift end (HH:MM):',w.end);if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');w.name=name.trim();w.start=start;w.end=end;w.effectiveStart=start;syncExternalWorkers();setDirty();last('External help updated');render()}else if(btn.dataset.action==='remove'&&w.isExternal){const isQuick=String(w.key).startsWith('external|kraft|');if(isQuick||confirm('Remove '+w.name+'?')){const i=DATA.workers.findIndex(x=>x.key===key);if(i>=0)DATA.workers.splice(i,1);delete assignments[key];delete notPresent[key];delete supportDestinations[key];delete supportTimes[key];delete breaks[key];syncExternalWorkers();setDirty();last('External help removed');render()}}})});if(!boardEditMode)document.querySelectorAll('.dropzone').forEach(z=>{let dragDepth=0;z.addEventListener('dragenter',e=>{if(draggedFlowId)return;e.preventDefault();dragDepth++;z.classList.add('drop-active')});z.addEventListener('dragover',e=>{if(draggedFlowId)return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';z.classList.add('drop-active')});z.addEventListener('dragleave',e=>{dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)z.classList.remove('drop-active')});z.addEventListener('drop',e=>{if(draggedFlowId)return;e.preventDefault();e.stopPropagation();dragDepth=0;z.classList.remove('drop-active');const key=e.dataTransfer.getData('text/plain')||draggedKey;if(!key||notPresent[key])return;if(z.dataset.areaId==='support'){const w=DATA.workers.find(x=>x.key===key);if(!w||!askSupportDetails(key,w))return}else{delete supportDestinations[key];delete supportTimes[key]}assignments[key]=z.dataset.areaId;setDirty();last(z.dataset.areaId==='support'?'Assigned to support '+supportDestinations[key]:'Moved to '+z.dataset.areaId);render()})})}
    function addExternal(){const name=prompt('External coworker name:');if(!name)return;const start=prompt('Shift start (HH:MM):','08:00');const end=prompt('Shift end (HH:MM):','16:00');if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start||'')||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end||'')||timeMinutes(end)<=timeMinutes(start))return alert('Please use valid HH:MM times, with end later than start.');const key='external|'+Date.now()+'-'+Math.random().toString(36).slice(2,7);DATA.workers.push({key,name:name.trim(),employeeId:'EXT',isExternal:true,start,end,effectiveStart:start,absences:[],badges:[],functionNames:[],functionBar:'#777777'});assignments[key]='unassigned';syncExternalWorkers();unassignedCollapsed=false;setDirty();last('External help added');render()}
    function addQuickKraftsamla(){const quickCount=DATA.workers.filter(w=>w.isExternal&&String(w.key).startsWith('external|kraft|')).length;if(quickCount>0&&quickCount%10===0&&!confirm('You already created '+quickCount+' Quick KRAFTSAMLA coworkers. Do you want to keep creating?'))return;let n=1;const used=new Set(DATA.workers.filter(w=>w.isExternal).map(w=>w.name));while(used.has('EXT HELP '+n))n++;const now=new Date();const start=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');let end='23:00';if(timeMinutes(start)>=timeMinutes(end))end='23:59';const key='external|kraft|'+Date.now()+'-'+Math.random().toString(36).slice(2,7);DATA.workers.push({key,name:'EXT HELP '+n,employeeId:'EXT',isExternal:true,start,end,effectiveStart:start,absences:[],badges:[],functionNames:[],functionBar:'#777777'});assignments[key]='unassigned';syncExternalWorkers();unassignedCollapsed=false;setDirty();last('Quick KRAFTSAMLA help added');render()}
    function resetBoard(){if(!confirm('Reset the board? Assignments, absences, breaks, manual time changes, external help, handover notes and custom flow/area changes will be cleared.'))return;assignments={};notPresent={};supportDestinations={};supportTimes={};breaks={};workerOverrides={};handoverNotes='';boardFlows=DATA.areas.map(g=>({id:g.id,group:g.group,areas:(g.areas||[]).map(a=>({...a}))}));for(const [key,o] of ORIGINAL_WORKERS.entries()){const w=DATA.workers.find(x=>x.key===key);if(w){w.start=o.start;w.end=o.end;w.effectiveStart=o.effectiveStart}}for(let i=DATA.workers.length-1;i>=0;i--)if(DATA.workers[i].isExternal)DATA.workers.splice(i,1);externalWorkers=[];unassignedCollapsed=false;setDirty();last('Board reset');render()}
    function currentPortableHTML(){syncExternalWorkers();document.getElementById('tp-state').textContent=JSON.stringify({assignments,notPresent,supportDestinations,supportTimes,breaks,boardFlows,handoverNotes,externalWorkers,workerOverrides,lastUpdated});return '<!DOCTYPE html>\\n'+document.documentElement.outerHTML}
    function boardShareStamp(){const now=new Date();const hh=String(now.getHours()).padStart(2,'0');const mm=String(now.getMinutes()).padStart(2,'0');return {time:hh+':'+mm,date:DATA.formattedDate||DATA.date}}
    function saveHTML(){const html=currentPortableHTML();const now=new Date();const stamp=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+'-'+String(now.getHours()).padStart(2,'0')+'-'+String(now.getMinutes()).padStart(2,'0');const blob=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='TimePlan-Handover-'+stamp+'.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setDirty(false);document.getElementById('lastChange').textContent='Handover saved '+stamp;refreshHeaderTimes()}
    async function quickShare(){saveHTML()}
    function preparePrintLayout(){document.querySelectorAll('.print-hidden').forEach(el=>el.classList.remove('print-hidden'));if(workersFor('unassigned').length===0)document.getElementById('unassignedWrapper').classList.add('print-hidden');if(workersFor('leadership').length===0)document.getElementById('leadership').classList.add('print-hidden');const supportEl=document.getElementById('support');if(supportEl&&workersFor('support').length===0)supportEl.classList.add('print-hidden');document.querySelectorAll('#board .flow').forEach((flow,index)=>{let visible=0;flow.querySelectorAll('.dropzone').forEach(zone=>{const count=workersFor(zone.dataset.areaId).length;if(count===0)zone.classList.add('print-hidden');else visible+=count});if(visible===0)flow.classList.add('print-hidden')});const visibleFlows=[...document.querySelectorAll('#board .flow')].filter(el=>!el.classList.contains('print-hidden')).length;document.documentElement.style.setProperty('--print-columns',String(Math.max(1,Math.min(3,visibleFlows||1))))}
    function cleanupPrintLayout(){document.querySelectorAll('.print-hidden').forEach(el=>el.classList.remove('print-hidden'));document.documentElement.style.removeProperty('--print-columns')}
    function exportPDF(){preparePrintLayout();setTimeout(()=>window.print(),30)}
    const basicPlanButton=document.getElementById('basicPlanButton'),basicPlanMenu=document.getElementById('basicPlanMenu'),shareButton=document.getElementById('shareButton'),shareMenu=document.getElementById('shareMenu');basicPlanButton.onclick=e=>{e.stopPropagation();shareMenu.style.display='none';basicPlanMenu.style.display=basicPlanMenu.style.display==='block'?'none':'block'};document.querySelectorAll('.basic-plan-choice').forEach(b=>b.onclick=e=>{e.stopPropagation();basicPlanMenu.style.display='none';applyBasicPlan(b.dataset.mode)});document.getElementById('externalButton').onclick=addExternal;document.getElementById('kraftButton').onclick=addQuickKraftsamla;const editFlowsButton=document.getElementById('editFlowsButton'),addFlowButton=document.getElementById('addFlowButton');editFlowsButton.onclick=()=>{boardEditMode=!boardEditMode;document.querySelectorAll('[data-board-operation]').forEach(b=>{b.disabled=boardEditMode;b.style.opacity=boardEditMode?'.45':'1';b.style.cursor=boardEditMode?'not-allowed':''});editFlowsButton.textContent=boardEditMode?'Done Editing':'Edit Flows';editFlowsButton.style.background=boardEditMode?'#2E7D32':'white';editFlowsButton.style.borderColor=boardEditMode?'#2E7D32':'#AAA';editFlowsButton.style.color=boardEditMode?'white':'#333';addFlowButton.style.display=boardEditMode?'inline-block':'none';addFlowButton.style.background=boardEditMode?'#EAF3FA':'white';addFlowButton.style.borderColor=boardEditMode?'#8EBFE3':'#AAA';addFlowButton.style.color=boardEditMode?'#0058A3':'#333';last(boardEditMode?'Flow editing mode — finish editing to operate the board':'Flow editing finished');render()};addFlowButton.onclick=addFlow;shareButton.onclick=e=>{e.stopPropagation();basicPlanMenu.style.display='none';shareMenu.style.display=shareMenu.style.display==='block'?'none':'block'};shareMenu.onclick=e=>e.stopPropagation();shareMenu.querySelector('[data-share="quick"]').onclick=()=>{shareMenu.style.display='none';saveHTML()};shareMenu.querySelector('[data-share="pdf"]').onclick=()=>{shareMenu.style.display='none';exportPDF()};document.getElementById('resetButton').onclick=resetBoard;const reminder=document.getElementById('handoverReminder');document.getElementById('handoverNotNow').onclick=()=>reminder.classList.remove('show');document.getElementById('handoverSaveNow').onclick=()=>{reminder.classList.remove('show');saveHTML()};document.addEventListener('click',()=>{basicPlanMenu.style.display='none';shareMenu.style.display='none';document.querySelectorAll('.magnet-menu').forEach(m=>m.style.display='none');document.querySelectorAll('.worker.menu-open').forEach(w=>w.classList.remove('menu-open'))});window.addEventListener('beforeunload',e=>{saveBoardRecovery();e.preventDefault();e.returnValue=''});window.addEventListener('beforeprint',preparePrintLayout);window.addEventListener('afterprint',cleanupPrintLayout);window.addEventListener('resize',()=>{requestAnimationFrame(updateSticky);requestAnimationFrame(repositionOpenMenu)});window.addEventListener('scroll',()=>{requestAnimationFrame(repositionOpenMenu)},true);setInterval(refreshHeaderTimes,1000);setInterval(()=>{const now=new Date();if(DATA.date===localISODate()&&!handoverReminderShown&&now.getHours()===13&&now.getMinutes()>=50&&now.getMinutes()<55){handoverReminderShown=true;reminder.classList.add('show')}if(!document.querySelector('.magnet-menu[style*="block"]'))render()},10000);render();
    <\/script>
    </body>
    </html>`;
        }

        return Object.freeze({ buildInteractiveBoardHTML });
    }

    // Legacy in-page board UI components, kept for compatibility with the app.
    // The operational standalone Interactive Board is still generated by createStandaloneHTML.
    function createBoardComponents(deps) {
        const {
            TOOL_FONT, TP_BLUE, TP_LIGHT_BLUE, escapeHTML, formatTime,
            getWorkerKey, isWorkerNotPresent, getFunctionBarBackground,
            renderCapabilityBadges, renderAbsenceIndicator, setWorkerNotPresent,
            editExternalHelp, removeExternalHelp, groupUnassignedWorkers,
            sortWorkersByStart, getWorkerEffectiveStart, assignWorker, renderPanel,
            applyBasicPlan
        } = deps;
        let draggedWorkerKey;
        // Keep the drag state local to this module. The getter/setter bridge
        // is available for future integration, but existing drop zones share
        // the same closure and do not depend on the main app's drag variable.
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

        return Object.freeze({ createBasicPlanMenu, createWorkerMagnet, createDropZone });
    }

    // State operations: date-specific storage is provided by the host app.
    function createBoardState(deps) {
        const {
            boardAssignments, notPresentByDate, externalWorkersByDate,
            unassignedCollapsedByDate, getSelectedDate, getCurrentDays,
            BOARD_AREAS, timeToMinutes, formatTime, sortWorkersByStart,
            renderPanel
        } = deps;
    function getWorkerKey(worker) { return worker.key || [worker.employeeId, worker.start, worker.end].join('|'); }
    function getAssignmentsForSelectedDate() { return (boardAssignments[getSelectedDate()] ||= {}); }
    function getNotPresentForSelectedDate() { return (notPresentByDate[getSelectedDate()] ||= {}); }
    function getExternalWorkersForSelectedDate() { return (externalWorkersByDate[getSelectedDate()] ||= []); }
    function getBoardWorkersForSelectedDate() { return [...(getCurrentDays()[getSelectedDate()] || []), ...getExternalWorkersForSelectedDate()]; }
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
        return `${getSelectedDate()}T${time}:00.000Z`;
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
        unassignedCollapsedByDate[getSelectedDate()] = false;
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
        boardAssignments[getSelectedDate()] = {};
        notPresentByDate[getSelectedDate()] = {};
        externalWorkersByDate[getSelectedDate()] = [];
        unassignedCollapsedByDate[getSelectedDate()] = false;
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


        return Object.freeze({
            getWorkerKey, getAssignmentsForSelectedDate, getNotPresentForSelectedDate,
            getExternalWorkersForSelectedDate, getBoardWorkersForSelectedDate,
            getWorkerAssignment, assignWorker, setWorkerNotPresent,
            addExternalHelp, editExternalHelp, removeExternalHelp, resetBoard,
            buildWorkersByArea, findAreaInfo
        });
    }

    // CSV and print/PDF exports (unchanged markup and formatting).
    function createBoardExports(deps) {
        const {
            getBoardWorkersForSelectedDate, getSelectedDate, getCurrentDays,
            sortWorkersByStart, findAreaInfo, getWorkerAssignment,
            isWorkerNotPresent, getCapabilityLabels, getFunctionNames,
            formatTime, BOARD_DEPARTMENT_CODE, buildWorkersByArea,
            BOARD_AREAS, escapeHTML, TOOL_FONT, TP_BLUE,
            getFunctionBarBackground, renderCapabilityBadges,
            renderAbsenceIndicator, getUniqueCoworkerCount,
            formatDate, formatGeneratedTime
        } = deps;
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
            return [getSelectedDate(), worker.name, worker.employeeId, formatTime(worker.start), formatTime(worker.end), area.flow, area.area, isWorkerNotPresent(worker) ? 'Not Present' : (worker.isExternal ? 'External Help' : 'Present'), getCapabilityLabels(worker).join('|'), getFunctionNames(worker).join('|')];
        });
        const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
        downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `TimePlan-Board-${BOARD_DEPARTMENT_CODE}-${getSelectedDate()}.csv`);
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
        const workers = getCurrentDays()[getSelectedDate()];
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

        return Object.freeze({ exportBoardToCSV, exportBoardToPDF, downloadBlob });
    }

    global.TimePlanInteractiveBoard = Object.freeze({
        isSupportedDepartment,
        getDefaultFlows,
        createBasicPlan,
        createExportData,
        createStandaloneHTML,
        createBoardComponents,
        createBoardState,
        createBoardExports
    });
})(window);
