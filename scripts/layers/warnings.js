// Met Éireann weather warnings, by county.
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'Met Éireann weather warnings',
    url: 'https://www.met.ie/warnings',
    licence: 'CC BY 4.0'
};

// Met Éireann uses FIPS 10-4 region codes. Checked against the county shapes on met.ie/warnings
// (EI14 sits beside Donegal, so it's Leitrim; EI15 beside Offaly, so it's Laois).
const REGIONS = {
    EI01: 'carlow', EI02: 'cavan', EI03: 'clare', EI04: 'cork', EI06: 'donegal', EI07: 'dublin',
    EI10: 'galway', EI11: 'kerry', EI12: 'kildare', EI13: 'kilkenny', EI14: 'leitrim', EI15: 'laois',
    EI16: 'limerick', EI18: 'longford', EI19: 'louth', EI20: 'mayo', EI21: 'meath', EI22: 'monaghan',
    EI23: 'offaly', EI24: 'roscommon', EI25: 'sligo', EI26: 'tipperary', EI27: 'waterford',
    EI29: 'westmeath', EI30: 'wexford', EI31: 'wicklow'
};

const LEVEL_RANK = { yellow: 1, orange: 2, red: 3 };

const plain = html => String(html || '').replace(/<li>/g, '• ').replace(/<\/(p|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();

async function fetchWarnings() {
    const raw = await getJson('https://www.met.ie/Open_Data/json/warning_IRELAND.json');
    const now = Date.now();

    const warnings = raw
        .filter(w => new Date(w.expiry).getTime() > now)
        .map(w => ({
            id: w.capId || String(w.id),
            level: String(w.level).toLowerCase(),
            type: w.type,
            headline: w.headline,
            description: plain(w.description),
            onset: w.onset,
            expiry: w.expiry,
            // Codes with an extra digit (e.g. EI031) are sub-regions of a county
            counties: [...new Set((w.regions || []).map(code => REGIONS[code.slice(0, 4)]).filter(Boolean))]
        }));

    const counties = {};
    for (const w of warnings) {
        for (const id of w.counties) {
            const c = counties[id] || (counties[id] = { level: null, warnings: [] });
            c.warnings.push(w.id);
            if (!c.level || LEVEL_RANK[w.level] > LEVEL_RANK[c.level]) c.level = w.level;
        }
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, warnings, counties };
}

module.exports = { fetchWarnings };
