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

    global.TimePlanInteractiveBoard = Object.freeze({
        isSupportedDepartment,
        getDefaultFlows,
        createBasicPlan,
        createExportData
    });
})(window);
