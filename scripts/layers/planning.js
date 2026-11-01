// Planning applications received per county, from the national planning application points.
// Counts only: we ask the service for grouped totals and never download individual applications.
// The data lags about 9-10 days and some councils' feeds have stopped, so each county says if it is incomplete.
const { getJson } = require('../lib/http');
const { countyFromName, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'Department of Housing, Local Government and Heritage and local authorities (Planning Application Points)',
    url: 'https://data-housinggovie.opendata.arcgis.com/datasets/housinggovie::planning-application-points',
    licence: 'CC BY 4.0'
};
const QUERY = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const WINDOW_DAYS = 30;
const STALE_DAYS = 21;
const DAY = 86400000;

const iso = ms => new Date(ms).toISOString().slice(0, 10);

async function query(params) {
    const qs = new URLSearchParams({ f: 'json', ...params }).toString();
    const json = await getJson(`${QUERY}?${qs}`);
    if (json?.error || !Array.isArray(json?.features)) throw new Error(`Planning service gave an unexpected answer${json?.error?.message ? `: ${json.error.message}` : ''}`);
    return json.features.map(f => f.attributes || {});
}

const stat = (type, field, as) => JSON.stringify([{ statisticType: type, onStatisticField: field, outStatisticFieldName: as }]);

async function fetchPlanning() {
    const [overall] = await query({ where: '1=1', outStatistics: stat('max', 'ReceivedDate', 'mx') });
    const newestMs = overall?.mx;
    if (!Number.isFinite(newestMs) || newestMs < Date.UTC(2020, 0, 1)) throw new Error('Planning service gave no usable newest date');

    const toDay = iso(newestMs);
    const fromDay = iso(newestMs - (WINDOW_DAYS - 1) * DAY);
    const [counts, newest] = await Promise.all([
        query({
            where: `ReceivedDate >= timestamp '${fromDay}' AND ReceivedDate <= timestamp '${toDay}'`,
            groupByFieldsForStatistics: 'PlanningAuthority',
            outStatistics: stat('count', 'OBJECTID', 'n')
        }),
        // Every authority's all-time newest date, so a council whose feed has stopped still shows up (with no recent counts)
        query({ where: '1=1', groupByFieldsForStatistics: 'PlanningAuthority', outStatistics: stat('max', 'ReceivedDate', 'mx') })
    ]);
    if (newest.length < 20) throw new Error(`Planning service listed only ${newest.length} authorities`);

    const countOf = new Map(counts.map(r => [r.PlanningAuthority, Number(r.n)]));
    const counties = {};
    for (const r of newest) {
        const name = r.PlanningAuthority;
        const id = countyFromName(name);
        if (!id || !ROI_IDS.includes(id)) throw new Error(`Unrecognised planning authority "${name}"`);
        if (!Number.isFinite(r.mx)) continue;
        const c = counties[id] || (counties[id] = { applications: 0, authorities: [], incomplete: false });
        const n = countOf.get(name) || 0;
        c.applications += n;
        c.authorities.push({ name, applications: n, newest: iso(r.mx) });
        if (newestMs - r.mx > STALE_DAYS * DAY) c.incomplete = true;
    }
    for (const name of countOf.keys()) {
        if (!newest.some(r => r.PlanningAuthority === name)) throw new Error(`Planning authority "${name}" missing from the newest-date list`);
    }
    const total = Object.values(counties).reduce((s, c) => s + c.applications, 0);
    if (Object.keys(counties).length < 20 || total < 500) throw new Error('Planning counts look empty');

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: new Date(newestMs).toISOString(),
        period: { from: fromDay, to: toDay },
        counties
    };
}

module.exports = { fetchPlanning };
