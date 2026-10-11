/* TimePlan Tools — Full Serve department configuration.
   Path: web-edition/src/departments/full-serve.js
   Prepared for modularization; not yet connected to the main app.
*/
(function (global) {
    'use strict';

    global.TimePlanFullServe = Object.freeze({
        departmentId: '159',
        departmentCode: '094-4050',
        areas: [
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
        ]
    });
})(window);
