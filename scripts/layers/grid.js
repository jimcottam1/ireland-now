// EirGrid Smart Grid Dashboard: live electricity demand, wind output and carbon intensity (all-island).
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'EirGrid Smart Grid Dashboard',
    url: 'https://www.smartgriddashboard.com/',
    licence: 'EirGrid open data'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = d => `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

async function series(area) {
    // Ask for yesterday and today so there's data just after midnight
    const to = new Date();
    const from = new Date(to.getTime() - 86400000);
    const url = `https://www.smartgriddashboard.com/api/chart/?region=ALL&chartType=default&dateRange=day`
        + `&dateFrom=${day(from)}&dateTo=${day(to)}&areas=${area}`;
    const { Rows } = await getJson(url);
    return Rows.filter(r => r.Value !== null);
}

const latest = rows => rows.length ? rows[rows.length - 1] : null;

async function fetchGrid() {
    const [wind, demand, co2] = await Promise.all([series('windactual'), series('demandactual'), series('co2intensity')]);
    const w = latest(wind);
    const d = latest(demand);
    const c = latest(co2);

    // Last 24 hours of wind share, for a small chart
    const demandAt = new Map(demand.map(r => [r.EffectiveTime, r.Value]));
    const windShare = wind.slice(-96)
        .filter(r => demandAt.get(r.EffectiveTime))
        .map(r => [r.EffectiveTime, Math.round(100 * r.Value / demandAt.get(r.EffectiveTime))]);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        national: {
            time: d?.EffectiveTime || w?.EffectiveTime,
            demandMW: d?.Value ?? null,
            windMW: w?.Value ?? null,
            windPercent: w && d ? Math.round(100 * w.Value / d.Value) : null,
            co2: c?.Value ?? null,
            windShare
        }
    };
}

module.exports = { fetchGrid };
