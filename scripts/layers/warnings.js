// Weather warnings by county: Met Éireann for the Republic, the Met Office for Northern Ireland.
const { getJson, getText } = require('../lib/http');
const { dublinToIso } = require('../lib/time');
const { NI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'Met Éireann and Met Office weather warnings',
    url: 'https://www.met.ie/warnings',
    licence: 'CC BY 4.0 (Met Éireann), Open Government Licence (Met Office)'
};

const MET_OFFICE_NI = 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/ni';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NI_NAMES = { antrim: /antrim/i, armagh: /armagh/i, down: /\bdown\b/i, fermanagh: /fermanagh/i, londonderry: /derry/i, tyrone: /tyrone/i };

/** "0600 Mon 02 Nov" (UK time, same clock as Ireland) -> ISO, choosing the year that puts it nearest today */
function ukTime(text) {
    const m = String(text).match(/(\d{2})(\d{2})\s+\w{3}\s+(\d{1,2})\s+(\w{3})/);
    if (!m) return null;
    const month = MONTHS.indexOf(m[4].toLowerCase()) + 1;
    if (!month) return null;
    const year = new Date().getUTCFullYear();
    const options = [year - 1, year, year + 1].map(y => dublinToIso(y, month, Number(m[3]), Number(m[1]), Number(m[2])));
    return options.sort((a, b) => Math.abs(new Date(a) - Date.now()) - Math.abs(new Date(b) - Date.now()))[0];
}

/**
 * Met Office warnings for Northern Ireland, from its RSS feed. Items read like
 * "Yellow warning of rain affecting Northern Ireland: Antrim, Down valid from 0600 Mon 02 Nov to 1800 Mon 02 Nov".
 * If no county is named the warning covers all six; if the times can't be read, the publication time is used.
 */
function parseMetOffice(xml) {
    const tag = (block, name) => (block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map(item => {
        const title = tag(item, 'title');
        const description = tag(item, 'description');
        const level = (title.match(/^(yellow|amber|red)/i) || [])[1]?.toLowerCase();
        if (!level) return null;
        const valid = description.match(/valid from (.+?) to (.+?)(?:$|\.|\s*<)/i);
        const published = tag(item, 'pubDate') ? new Date(tag(item, 'pubDate')).toISOString() : new Date().toISOString();
        const named = Object.keys(NI_NAMES).filter(id => NI_NAMES[id].test(description.split(/valid from/i)[0].replace(/northern ireland/i, '')));
        return {
            id: tag(item, 'guid') || tag(item, 'link') || title,
            level: level === 'amber' ? 'orange' : level,   // same scale as Met Éireann's
            type: (title.match(/warning of (.+?) affecting/i) || [])[1] || 'weather',
            headline: title,
            description,
            onset: (valid && ukTime(valid[1])) || published,
            expiry: (valid && ukTime(valid[2])) || null,
            counties: named.length ? named : [...NI_IDS],
            issuer: 'Met Office',
            url: tag(item, 'link') || 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings'
        };
    }).filter(Boolean);
}

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
    // Northern Ireland: if the Met Office feed fails, carry on with Met Éireann's alone
    let ni = [];
    try {
        ni = parseMetOffice(await getText(MET_OFFICE_NI)).filter(w => !w.expiry || new Date(w.expiry).getTime() > now);
    } catch (error) {
        console.warn(`   Warnings: Met Office feed failed (${error.message})`);
    }

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
            counties: [...new Set((w.regions || []).map(code => REGIONS[code.slice(0, 4)]).filter(Boolean))],
            issuer: 'Met Éireann',
            url: 'https://www.met.ie/warnings'
        }))
        .concat(ni);

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

module.exports = { fetchWarnings, parseMetOffice };
