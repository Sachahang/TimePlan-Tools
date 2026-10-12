(function () {
    'use strict';
    // Batch D: extracted verbatim from the validated Batch C application.
    window.TimePlanCore = window.TimePlanCore || {};
    window.TimePlanCore.createFunctionUtils = function (deps) {
        const { TP_BLUE, minutesBetween, escapeHTML } = deps;

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

        // Oplæring is useful operational information even though it is not an
        // absence. Show it as a temporary capability-style badge for this day.
        if (worker.training) {
            map.set('status:training', {
                label: 'TRAINING',
                title: 'Oplæring / Training',
                color: '#7A5AF8'
            });
        }

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

        return { timePlanColorToHex, normalizeHexColor, getContrastTextColor, buildFunctionMap, getSpecialFunctionBadge, abbreviateFunctionName, getFunctionBadges, getCapabilityLabels, getFunctionNames, getFunctionBadgeStyle, renderCapabilityBadges, getFunctionBarBackground };
    };
})();
