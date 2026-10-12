(function () {
    'use strict';
    // Batch D: extracted verbatim from the validated Batch C application.
    window.TimePlanCore = window.TimePlanCore || {};
    window.TimePlanCore.createTimeUtils = function (deps) {
        const {  } = deps;

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

        return { getDateKey, formatTime, timeToMinutes, minutesBetween, getWorkerEffectiveStart, sortWorkersByStart, sortWorkersByOfficialStart, localDateObject, formatDate, formatShortDate, formatGeneratedTime };
    };
})();
