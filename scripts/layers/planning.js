// Planning applications received per county, from the national planning application points.
// Counts only: we ask the service for grouped totals and never download individual applications.
// The data lags about 9-10 days and some councils' feeds are stale or only trickle in, so the window ends on a
// date every healthy council has reached, and a county is marked incomplete when any of its councils looks wrong.
const { getJson } = require('../lib/http');
const { countyFromName, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'Department of Housing, Local Government and Heritage and local authorities (Planning Application Points)',
    url: 'https://data-housinggovie.opendata.arcgis.com/datasets/housinggovie::planning-application-points',
    licence: 'CC BY 4.0'
};
const QUERY = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const WINDOW_DAYS = 30;
const STALE_DAYS = 21;       // a council whose newest application is this far behind the rest has a dead feed
const LOW_SHARE = 0.4;       // a council with under this share of its previous 30 days looks like a trickle feed
const LOW_MIN_BEFORE = 20;   // ...but only when the previous count was big enough to mean something
const DAY = 86400000;

// Councils we expect for each county (the Republic's 31 planning authorities); any other county has one
const EXPECTED = {
    dublin: ['Dublin City Council', 'Dun Laoghaire Rathdown County Council', 'Fingal County Council', 'South Dublin County Council'],
    cork: ['Cork City Council', 'Cork County Council'],
    galway: ['Galway City Council', 'Galway County Council'],
    waterford: ['Waterford City and County Council'],
    limerick: ['Limerick County Council']
};
const expectedFor = id => EXPECTED[id] || [`${id[0].toUpperCase()}${id.slice(1)} County Council`];

const iso = ms => new Date(ms).toISOString().slice(0, 10);

async function query(params) {
    const qs = new URLSearchParams({ f: 'json', returnGeometry: 'false', ...params }).toString();
    const json = await getJson(`${QUERY}?${qs}`);
    if (json?.error || !Array.isArray(json?.features)) throw new Error(`Planning service gave an unexpected answer${json?.error?.message ? `: ${json.error.message}` : ''}`);
    return json.features.map(f => f.attributes || {});
}

const stat = (type, field, as) => JSON.stringify([{ statisticType: type, onStatisticField: field, outStatisticFieldName: as }]);
const HAS_AUTHORITY = 'PlanningAuthority IS NOT NULL';

async function fetchPlanning() {
    const now = Date.now();
    const today = iso(now);
    const valid = ms => Number.isFinite(ms) && ms > Date.UTC(2020, 0, 1) && ms <= now;   // a future date is a typo

    // Dates up to today only, so one future-dated typo can't jam the layer or make a stopped feed look fresh
    const upToToday = `ReceivedDate <= timestamp '${today}' AND ${HAS_AUTHORITY}`;
    const [[overall], newestRows] = await Promise.all([
        query({ where: upToToday, outStatistics: stat('max', 'ReceivedDate', 'mx') }),
        query({ where: upToToday, groupByFieldsForStatistics: 'PlanningAuthority', outStatistics: stat('max', 'ReceivedDate', 'mx') })
    ]);
    const newestMs = overall?.mx;
    if (!valid(newestMs)) throw new Error('Planning service gave no usable newest date');
    if (newestRows.length < 20) throw new Error(`Planning service listed only ${newestRows.length} authorities`);

    const newestOf = new Map(newestRows.map(r => [r.PlanningAuthority, valid(r.mx) ? r.mx : null]));
    // A feed with no usable date, or 21+ days behind the rest, is stale. The window ends on the earliest date the others have reached.
    const isStale = ms => ms == null || newestMs - ms > STALE_DAYS * DAY;
    const healthy = [...newestOf.values()].filter(ms => !isStale(ms));
    if (!healthy.length) throw new Error('Planning service has no current authority');
    const endMs = Math.min(...healthy);

    const to = iso(endMs);
    const from = iso(endMs - (WINDOW_DAYS - 1) * DAY);
    const before = iso(endMs - (2 * WINDOW_DAYS - 1) * DAY);
    const dayAfter = iso(endMs + DAY);
    const countQuery = (lo, hiExclusive) => query({
        where: `ReceivedDate >= timestamp '${lo}' AND ReceivedDate < timestamp '${hiExclusive}' AND ${HAS_AUTHORITY}`,
        groupByFieldsForStatistics: 'PlanningAuthority',
        outStatistics: stat('count', 'OBJECTID', 'n')
    });
    const [counts, previous] = await Promise.all([countQuery(from, dayAfter), countQuery(before, from)]);

    const countOf = new Map(counts.map(r => [r.PlanningAuthority, Number(r.n)]));
    const beforeOf = new Map(previous.map(r => [r.PlanningAuthority, Number(r.n)]));
    const names = new Set([...newestOf.keys(), ...countOf.keys(), ...beforeOf.keys()]);

    const counties = {};
    for (const name of names) {
        const id = countyFromName(name);
        if (!id || !ROI_IDS.includes(id)) throw new Error(`Unrecognised planning authority "${name}"`);
        const c = counties[id] || (counties[id] = { applications: 0, authorities: [], missing: [], incomplete: false });
        const n = countOf.get(name) || 0;
        const newest = newestOf.get(name) ?? null;   // null: no usable date, or only seen in the counts
        const prev = beforeOf.get(name) || 0;
        let issue = null;
        if (isStale(newest)) issue = 'stale';
        else if (prev >= LOW_MIN_BEFORE && n < LOW_SHARE * prev) issue = 'low';
        c.applications += n;
        c.authorities.push({ name, applications: n, newest: newest == null ? null : iso(newest), issue });
        if (issue) c.incomplete = true;
    }
    // A council that has vanished or been renamed, or a whole county that is missing, makes the county incomplete
    for (const id of ROI_IDS) {
        const c = counties[id] || (counties[id] = { applications: 0, authorities: [], missing: [], incomplete: false });
        const have = new Set(c.authorities.map(a => a.name));
        c.missing = expectedFor(id).filter(n => !have.has(n));
        if (c.missing.length) c.incomplete = true;
    }
    const total = Object.values(counties).reduce((s, c) => s + c.applications, 0);
    if (total < 500) throw new Error('Planning counts look empty');

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: new Date(newestMs).toISOString(),
        period: { from, to },
        counties
    };
}

module.exports = { fetchPlanning };
