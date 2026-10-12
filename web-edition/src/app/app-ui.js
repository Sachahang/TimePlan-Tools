// Batch E: Web Edition panel, tabs and date selection.
(function () {
    'use strict';
    window.TimePlanAppUI = function createAppUI(deps) {
        const {
        PANEL_ID, BUTTON_ID, TP_BLUE, TOOL_FONT, BOARD_DEPARTMENT_CODE,
        getCurrentDays, getSelectedDate, setSelectedDate, getSnapshotCapturedAt,
        formatShortDate, formatDate, formatTime, escapeHTML, getUniqueCoworkerCount,
        isBoardDepartment, openInteractiveBoard, sortWorkersByOfficialStart,
        renderCapabilityBadges, renderFunctionBadges, getFunctionBadges,
        normalizeHexColor, getContrastTextColor
        } = deps;
    function renderDayButtons(panel) {
        const selector = document.createElement('div');
        selector.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:15px 0;padding-bottom:14px;border-bottom:2px solid #ddd;';
        Object.keys(getCurrentDays()).sort().forEach(date => {
            const button = document.createElement('button');
            const selected = date === getSelectedDate();
            button.textContent = formatShortDate(date);
            button.style.cssText = `font-family:${TOOL_FONT};border:1px solid ${selected ? TP_BLUE : '#ccc'};background:${selected ? TP_BLUE : '#f3f3f3'};color:${selected ? '#fff' : '#222'};border-radius:6px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;`;
            button.onclick = () => { setSelectedDate(date); renderPanel(); };
            selector.appendChild(button);
        });
        panel.appendChild(selector);
    }

    function renderViewTabs(panel) {
        // TimePlan Tools now has one embedded data view (Sorted View).
        // Board Planning is the operational Interactive Board, so the second
        // control acts as a launcher instead of rendering a duplicate board.
        // Sorted View is the only embedded view.

        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;gap:8px;margin-bottom:18px;';

        const sortedButton = document.createElement('button');
        sortedButton.textContent = 'Sorted View';
        sortedButton.style.cssText = `font-family:${TOOL_FONT};border:2px solid ${TP_BLUE};background:${TP_BLUE};color:#fff;padding:9px 16px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;`;
        sortedButton.onclick = () => { renderPanel(); };
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

    function renderPanel() {
        document.getElementById(PANEL_ID)?.remove();
        const dates = Object.keys(getCurrentDays()).sort();
        if (!dates.length) return;
        if (!getSelectedDate() || !getCurrentDays()[getSelectedDate()]) setSelectedDate(dates[0]);
        // Sorted View is the only embedded view.

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `position:relative;margin:18px 24px;padding:20px;background:white;border:2px solid ${TP_BLUE};border-radius:8px;box-shadow:0 3px 14px rgba(0,0,0,.18);font-family:${TOOL_FONT};z-index:9999;color:#222;overflow-x:auto;`;
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        top.innerHTML = `<div><div style="font-size:22px;font-weight:800;color:${TP_BLUE};">TimePlan Tools</div><div style="font-size:13px;color:#666;margin-top:3px;">Department Plan</div></div>`;
        if (getSnapshotCapturedAt()) {
            const stamp = document.createElement('div');
            stamp.style.cssText = 'font-size:12px;color:#666;margin-top:5px;';
            stamp.textContent = 'Snapshot · ' + new Intl.DateTimeFormat('en-GB', {dateStyle:'medium',timeStyle:'short'}).format(getSnapshotCapturedAt());
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
                    currentDays: getCurrentDays(), selectedDate: getSelectedDate()
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


    return { renderPanel, updateButtonState };
    };
})();
