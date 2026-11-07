// Department of Housing monthly homelessness reports: people in council-funded emergency accommodation
// during one week of the month, by region (the nine regions councils run homeless services in).
//
// Each month is its own dataset on opendata.housing.gov.ie, at a predictable address
// (/dataset/homelessness-report-august-2026). The portal's /api/ is disallowed in its robots.txt,
// so the CSV link is read from the dataset page instead.
const { getText } = require('../lib/http');

const SOURCE = {
    name: 'Department of Housing homelessness reports',
    url: 'https://www.gov.ie/en/department-of-housing-local-government-and-heritage/collections/homelessness-data/',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
};

const PORTAL = 'https://opendata.housing.gov.ie/dataset/';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const LOOK_BACK = 6; // months; a report is published about a month after the week it counts

// The Department's regions, as named in the CSV, and the counties in each
const REGIONS = {
    'Dublin': ['dublin'],
    'Mid-East': ['kildare', 'meath', 'wicklow'],
    'Midlands': ['laois', 'longford', 'offaly', 'westmeath'],
    'Mid-West': ['clare', 'limerick'],
    'North-East': ['cavan', 'louth', 'monaghan'],
    'North-West': ['donegal', 'leitrim', 'sligo'],
    'South-East': ['carlow', 'kilkenny', 'tipperary', 'waterford', 'wexford'],
    'South-West': ['cork', 'kerry'],
    'West': ['galway', 'mayo', 'roscommon']
};

const COLUMNS = { adults: 'Total Adults', families: 'Number of Families', children: 'Number of Dependants in Families' };

const regionId = name => name.toLowerCase();

/** The CSV link on one month's dataset page, or null if that month isn't published (404). */
async function csvFor(year, monthIndex) {
    let html;
    try {
        html = await getText(`${PORTAL}homelessness-report-${MONTHS[monthIndex]}-${year}`);
    } catch (error) {
        if (/HTTP 404/.test(error.message)) return null;
        throw error;
    }
    const link = html.match(/https:\/\/opendata\.housing\.gov\.ie\/dataset\/[^"'\s]+\/download\/[^"'\s]+\.csv/i);
    if (!link) throw new Error(`Homelessness ${MONTHS[monthIndex]} ${year}: dataset page has no CSV link`);
    return link[0];
}

/** { regionId: { adults, families, children, people } } from one month's CSV; throws on anything unexpected. */
function parse(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.some(l => l.includes('"'))) throw new Error('Homelessness CSV layout changed (quoted fields)');
    const header = lines[0].split(',').map(h => h.trim());
    const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, header.indexOf(name)]));
    const missing = Object.entries(at).filter(([, i]) => i < 0).map(([key]) => COLUMNS[key]);
    if (header[0] !== 'Region' || missing.length) throw new Error(`Homelessness CSV columns changed (missing ${missing.join(', ') || 'Region'})`);

    const regions = {};
    for (const line of lines.slice(1)) {
        const cells = line.split(',').map(c => c.trim());
        const name = cells[0];
        if (!REGIONS[name]) throw new Error(`Homelessness CSV has an unknown region "${name}"`);
        const row = {};
        for (const [key, i] of Object.entries(at)) {
            if (!/^\d+$/.test(cells[i] || '')) throw new Error(`Homelessness CSV: "${cells[i]}" for ${name} ${COLUMNS[key]} is not a number`);
            row[key] = Number(cells[i]);
        }
        row.people = row.adults + row.children;
        regions[regionId(name)] = row;
    }
    const absent = Object.keys(REGIONS).filter(name => !regions[regionId(name)]);
    if (absent.length) throw new Error(`Homelessness CSV is missing ${absent.join(', ')}`);
    return regions;
}

const change = (now, before) => before ? Number((100 * (now - before) / before).toFixed(1)) : null;

async function fetchHomelessness() {
    // Newest first, starting with last month
    const today = new Date();
    let found = null;
    for (let back = 1; back <= LOOK_BACK && !found; back++) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
        const url = await csvFor(d.getUTCFullYear(), d.getUTCMonth());
        if (url) found = { year: d.getUTCFullYear(), month: d.getUTCMonth(), url };
    }
    if (!found) throw new Error(`No homelessness report found for the last ${LOOK_BACK} months`);

    const current = parse(await getText(found.url));

    // The same month a year earlier, for the change; optional
    let previous = null;
    try {
        const url = await csvFor(found.year - 1, found.month);
        if (url) previous = parse(await getText(url));
    } catch (error) {
        console.warn(`   Homelessness: no year-earlier report (${error.message})`);
    }

    const regions = {};
    const counties = {};
    const national = { adults: 0, families: 0, children: 0, people: 0 };
    const nationalBefore = { people: 0 };
    for (const [name, members] of Object.entries(REGIONS)) {
        const id = regionId(name);
        const r = current[id];
        const before = previous?.[id];
        regions[id] = { name, counties: members, ...r, change: change(r.people, before?.people) };
        for (const county of members) counties[county] = { region: id };
        for (const key of Object.keys(national)) national[key] += r[key];
        if (before) nationalBefore.people += before.people;
    }
    national.change = previous ? change(national.people, nationalBefore.people) : null;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        month: `${found.year}-${String(found.month + 1).padStart(2, '0')}`,
        regions,
        counties,
        national
    };
}

module.exports = { fetchHomelessness };
