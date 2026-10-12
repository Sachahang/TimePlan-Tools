// Batch E: board orchestration, independent from the UI and roster bridge.
(function () {
    'use strict';
    window.TimePlanAppBoardController = function createBoardController(deps) {
        const {
        isBoardDepartment, getBoardWorkersForSelectedDate, getSelectedDate, getCurrentDays,
        getSnapshotCapturedAt, getNativeTimePlanFontFamily, collectPortableTimePlanFontFaceCSS,
        collectTimePlanFontFaceCSS, getTimePlanStylesheetLinksHTML,
        formatDate, formatTime, sortWorkersByStart, getWorkerKey,
        getWorkerEffectiveStart, getFunctionBadges, getFunctionNames,
        getFunctionBarBackground, getAssignmentsForSelectedDate,
        getNotPresentForSelectedDate, BOARD_DEPARTMENT_CODE, BOARD_AREAS,
        safeJSONStringify, escapeHTML, escapeStyleClose, TOOL_FONT, TP_BLUE, TP_LIGHT_BLUE,
        findAreaInfo, getWorkerAssignment, isWorkerNotPresent, getCapabilityLabels,
        buildWorkersByArea, renderCapabilityBadges, renderAbsenceIndicator,
        getUniqueCoworkerCount, formatGeneratedTime
        } = deps;
    // ---------- Interactive HTML ----------

    // Export snapshot preparation lives in the Interactive Board module.
    // The complete standalone HTML template remains unchanged in this file.
    const exportData = window.TimePlanInteractiveBoard.createExportData({
        getBoardWorkersForSelectedDate,
        getSelectedDate,
        getSnapshotCapturedAt,
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
        getSelectedDate,
        getCurrentDays,
        sortWorkersByStart, findAreaInfo, getWorkerAssignment,
        isWorkerNotPresent, getCapabilityLabels, getFunctionNames,
        formatTime, BOARD_DEPARTMENT_CODE, buildWorkersByArea,
        BOARD_AREAS, escapeHTML, TOOL_FONT, TP_BLUE,
        getFunctionBarBackground, renderCapabilityBadges,
        renderAbsenceIndicator, getUniqueCoworkerCount,
        formatDate, formatGeneratedTime
    });
    const { exportBoardToCSV, exportBoardToPDF, downloadBlob } = boardExports;

    return { openInteractiveBoard, buildInteractiveBoardHTML, exportBoardToCSV, exportBoardToPDF, downloadBlob };

    };
})();
