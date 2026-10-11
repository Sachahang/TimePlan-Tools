/* TimePlan Tools — Sorted View module (prepared, not yet activated).
   The current app continues to work unchanged until this module is connected.
   Keep this file in web-edition/src/sorted-view/sorted-view.js
*/
(function (global) {
  'use strict';
  global.TimePlanSortedView = function createSortedView(deps) {
    const { TP_BLUE, TOOL_FONT, BOARD_DEPARTMENT_CODE, formatTime,
      formatDate, escapeHTML, getUniqueCoworkerCount, renderDayHeader,
      sortWorkersByOfficialStart, renderCapabilityBadges,
      renderFunctionBadges, getFunctionBadges, normalizeHexColor,
      getContrastTextColor } = deps;

    function renderSortedAbsenceInline(worker) {
        const segments = worker.absenceSegments || [];
        if (!segments.length) return '';

        const times = segments
            .map(segment => `${formatTime(segment.start)}&ndash;${formatTime(segment.end)}`)
            .join(', ');

        return `<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:5px;margin-left:8px;color:#8A4B47;font-size:12px;font-weight:700;white-space:normal;"><span style="color:#9E2F28;font-size:11px;font-weight:900;letter-spacing:.2px;">ABS</span><span>${times}</span></span>`;
    }

    function renderSortedView(panel) {
        const workers = deps.currentDays[deps.selectedDate];
        if (!workers?.length) return panel.insertAdjacentHTML('beforeend', '<p>No coworkers found for this day.</p>');
        renderDayHeader(panel, workers);
        const printBar = document.createElement('div');
        printBar.style.cssText = 'display:flex;justify-content:flex-end;margin:4px 0 10px;';
        const printButton = document.createElement('button');
        printButton.textContent = 'Print / PDF';
        printButton.style.cssText = `border:1px solid ${TP_BLUE};background:#fff;color:${TP_BLUE};border-radius:6px;padding:7px 11px;font-weight:800;cursor:pointer;`;
        printButton.onclick = () => exportSortedViewToPDF(workers);
        printBar.appendChild(printButton);
        panel.appendChild(printBar);
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

    function exportSortedViewToPDF(workers) {
        const groups = {};
        sortWorkersByOfficialStart(workers).forEach(worker => (groups[formatTime(worker.start)] ||= []).push(worker));

        const renderPrintCapabilityBadges = worker => {
            const badges = getFunctionBadges(worker);
            if (!badges.length) return '';
            return `<span class="cap-badges">${badges.map(badge => {
                const background = normalizeHexColor(badge.color);
                return `<span class="cap-badge" style="background:${background};border-color:${background};color:${getContrastTextColor(background)}">${escapeHTML(badge.label)}</span>`;
            }).join('')}</span>`;
        };

        const renderPrintFunctionBadges = worker => {
            const segments = worker.functionSegments || [];
            if (!segments.length) return '<span class="no-function">No function</span>';
            const multiple = segments.length > 1;
            return `<div class="function-list">${segments.map(segment => {
                const color = normalizeHexColor(segment.color);
                return `<div class="function-pill"><span class="function-color" style="background:${color}"></span><span class="function-content"><strong>${escapeHTML(segment.name)}</strong>${multiple ? `<span>${formatTime(segment.start)}&ndash;${formatTime(segment.end)}</span>` : ''}</span></div>`;
            }).join('')}</div>`;
        };

        const renderPrintAbsence = worker => {
            const segments = worker.absenceSegments || [];
            if (!segments.length) return '';
            return `<span class="absence"><strong>ABS</strong><span>${segments.map(segment => `${formatTime(segment.start)}&ndash;${formatTime(segment.end)}`).join(', ')}</span></span>`;
        };

        const rows = Object.entries(groups).map(([startTime, group]) => `
            <section class="group">
                <div class="group-start">
                    <strong>${startTime}</strong>
                    <span>${group.length} coworker${group.length === 1 ? '' : 's'}</span>
                </div>
                <div class="group-workers">
                    ${group.map(worker => `
                        <div class="worker-row">
                            <div class="identity">
                                <span class="worker-name">${escapeHTML(worker.name)}</span>
                                ${renderPrintCapabilityBadges(worker)}
                            </div>
                            <div class="schedule">
                                <span class="shift-time">${formatTime(worker.start)} &rarr; ${formatTime(worker.end)}</span>
                                ${renderPrintAbsence(worker)}
                            </div>
                            <div class="functions">${renderPrintFunctionBadges(worker)}</div>
                        </div>`).join('')}
                </div>
            </section>`).join('');

        const w = window.open('', '_blank', 'width=1200,height=850');
        if (!w) return alert('The browser blocked the print window.');

        w.document.write(`<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<title>Sorted View - ${deps.selectedDate}</title>
<style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:${TOOL_FONT};margin:0;color:#222;background:#fff}
.header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid ${TP_BLUE};padding-bottom:7px;margin-bottom:7px}
.title{font-size:20px;font-weight:850;color:${TP_BLUE};line-height:1.05}
.date{font-size:12px;font-weight:700;margin-top:3px}
.meta{text-align:right;font-size:9px;line-height:1.45;color:#666}
.group{display:grid;grid-template-columns:64px minmax(0,1fr);border-bottom:1px solid #C8C8C8;break-inside:avoid-page}
.group-start{padding:6px 6px 5px 1px;color:${TP_BLUE}}
.group-start strong{display:block;font-size:16px;line-height:1;font-weight:900}
.group-start span{display:block;margin-top:4px;font-size:8px;font-weight:750;color:#707070;white-space:nowrap}
.group-workers{min-width:0;padding:2px 0}
.worker-row{display:grid;grid-template-columns:minmax(175px,1.05fr) minmax(112px,.62fr) minmax(245px,1.45fr);column-gap:8px;align-items:center;min-height:34px;padding:4px 0;border-bottom:1px solid #ECECEC;break-inside:avoid}
.worker-row:last-child{border-bottom:0}
.identity{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.worker-name{font-size:10px;font-weight:800;line-height:1.15}
.cap-badges{display:inline-flex;flex-wrap:wrap;gap:2px;align-items:center}
.cap-badge{display:inline-flex;align-items:center;justify-content:center;height:15px;padding:0 4px;border:1px solid;border-radius:999px;font-size:7px;font-weight:900;line-height:1;white-space:nowrap;letter-spacing:.15px}
.schedule{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.shift-time{font-size:9px;font-weight:800;color:#555;white-space:nowrap}
.absence{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;color:#8A4B47;font-size:8px;font-weight:750}
.absence strong{display:inline-flex;align-items:center;justify-content:center;padding:1px 4px;border:1px solid #C85B52;border-radius:4px;background:#FFF8F7;color:#9E2F28;font-size:7px;font-weight:900}
.functions{min-width:0}
.function-list{display:flex;flex-wrap:wrap;gap:3px;align-items:center}
.function-pill{display:inline-flex;align-items:stretch;min-height:22px;background:#F7F7F7;border:1px solid #D8D8D8;border-radius:5px;overflow:hidden;white-space:nowrap}
.function-color{width:4px;min-width:4px}
.function-content{display:inline-flex;align-items:center;gap:5px;padding:3px 6px 3px 5px}
.function-content strong{font-size:8px;font-weight:800;color:#272727}
.function-content span{font-size:7px;font-weight:700;color:#777}
.no-function{font-size:8px;font-weight:650;color:#777}


@media print{body{width:100%}}
</style>
</head>
<body>
<div class="header">
    <div>
        <div class="title">TimePlan Sorted View</div>
        <div class="date">${escapeHTML(formatDate(workers[0].start))}</div>
    </div>
    <div class="meta">${getUniqueCoworkerCount(workers)} planned coworkers<br>Department ${BOARD_DEPARTMENT_CODE}</div>
</div>
${rows}
<script>window.onload=()=>setTimeout(()=>window.print(),120)<\/script>
</body>
</html>`);
        w.document.close();
    }


    return { renderSortedView, exportSortedViewToPDF };
  };
})(window);
