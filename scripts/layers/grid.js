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
    // The dashboard sometimes answers with an empty series; one retry usually fixes it
    for (let attempt = 0; attempt < 2; attempt++) {
        const { Rows } = await getJson(url);
        const rows = (Rows || []).filter(r => r.Value !== null);
        if (rows.length) return rows;
        await new Promise(r => setTimeout(r, 3000));
    }
    return [];
}

/** "31-Oct-2026 21:00:00" (Irish local time) -> ISO UTC */
function dublinTime(text) {
    const asUtc = new Date(String(text).replace(/-/g, ' ') + ' UTC');
    if (Number.isNaN(asUtc.getTime())) return null;
    const wall = tz => new Date(asUtc.toLocaleString('en-US', { timeZone: tz }));
    return new Date(asUtc - (wall('Europe/Dublin') - wall('UTC'))).toISOString();
}

const latest = rows => rows.length ? rows[rows.length - 1] : null;

async function fetchGrid() {
    // One at a time: the dashboard returned empty series when asked for all three at once
    const wind = await series('windactual');
    const demand = await series('demandactual');
    const co2 = await series('co2intensity');
    if (!wind.length || !demand.length) throw new Error('EirGrid returned no wind or demand data');
    const w = latest(wind);
    const d = latest(demand);
    const c = latest(co2);

    // Last 24 hours of wind share, for a small chart
    const demandAt = new Map(demand.map(r => [r.EffectiveTime, r.Value]));
    const windShare = wind.slice(-96)
        .filter(r => demandAt.get(r.EffectiveTime))
        .map(r => [r.EffectiveTime, Math.round(100 * r.Value / demandAt.get(r.EffectiveTime))]);

    // Last 24 hours of demand and wind output in MW, every 30 minutes (readings are every 15)
    const windAt = new Map(wind.map(r => [r.EffectiveTime, r.Value]));
    const day = demand.slice(-96).filter((_, i, all) => (all.length - 1 - i) % 2 === 0)
        .map(r => [r.EffectiveTime, Math.round(r.Value), windAt.has(r.EffectiveTime) ? Math.round(windAt.get(r.EffectiveTime)) : null]);
    const peak = demand.slice(-96).reduce((best, r) => (r.Value > (best?.Value ?? -1) ? r : best), null);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        national: {
            time: d?.EffectiveTime || w?.EffectiveTime,
            sourceTime: dublinTime(d?.EffectiveTime || w?.EffectiveTime),
            demandMW: d?.Value ?? null,
            windMW: w?.Value ?? null,
            windPercent: w && d ? Math.round(100 * w.Value / d.Value) : null,
            co2: c?.Value ?? null,
            windShare,
            day,
            peakMW: peak ? Math.round(peak.Value) : null,
            peakTime: peak?.EffectiveTime || null
        }
    };
}

module.exports = { fetchGrid };
