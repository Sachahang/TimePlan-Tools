/* TimePlan Tools — Interactive Board module (preparation)
   Destination: web-edition/src/interactive-board/interactive-board.js

   Step 61: Standalone preparation only.
   This file is NOT loaded by index.html yet and does not change the live app.
   The existing Interactive Board remains in timeplan-tools-app.js.
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

    global.TimePlanInteractiveBoard = Object.freeze({
        isSupportedDepartment,
        getDefaultFlows
    });
})(window);
