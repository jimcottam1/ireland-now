// OPW river and lake levels (waterlevel.ie), with rising/falling worked out from our own history,
// since the feed only gives the latest reading.
const { getJson } = require('../lib/http');
const { countyAt } = require('../lib/geo');
const state = require('../lib/state');

const SOURCE = {
    name: 'OPW hydrometric data (waterlevel.ie)',
    url: 'https://waterlevel.ie/',
    licence: 'CC BY 4.0'
};

const HISTORY_HOURS = 48;
const TREND_HOURS = 6;
// Change in level over TREND_HOURS, in metres
const RISING = 0.10;
const RISING_FAST = 0.30;

function trendOf(change) {
    if (change === null) return 'unknown';
    if (change >= RISING_FAST) return 'rising-fast';
    if (change >= RISING) return 'rising';
    if (change <= -RISING) return 'falling';
    return 'steady';
}

async function fetchRivers() {
    const raw = await getJson('https://waterlevel.ie/geojson/latest/', { timeoutMs: 60000 });
    const history = state.read('river-history', {});
    const cutoff = Date.now() - HISTORY_HOURS * 3600000;

    const stations = [];
    for (const f of raw.features) {
        const p = f.properties;
        if (p.sensor_ref !== '0001') continue; // 0001 is water level; other sensors are temperature, battery etc.
        const level = parseFloat(p.value);
        if (!Number.isFinite(level) || !f.geometry) continue;

        const ref = p.station_ref;
        const [lon, lat] = f.geometry.coordinates;
        const readings = (history[ref] || []).filter(([t]) => new Date(t).getTime() >= cutoff);
        if (!readings.length || readings[readings.length - 1][0] !== p.datetime) readings.push([p.datetime, level]);
        history[ref] = readings;

        // Compare with the reading nearest to TREND_HOURS ago, if we have one at least 4 hours old
        const target = new Date(p.datetime).getTime() - TREND_HOURS * 3600000;
        const older = readings.filter(([t]) => new Date(t).getTime() <= new Date(p.datetime).getTime() - 4 * 3600000);
        const past = older.length
            ? older.reduce((a, b) => Math.abs(new Date(a[0]) - target) < Math.abs(new Date(b[0]) - target) ? a : b)
            : null;
        const change = past ? Number((level - past[1]).toFixed(3)) : null;

        stations.push({
            ref,
            name: p.station_name,
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
            level,
            time: p.datetime,
            change,
            trend: trendOf(change),
            county: countyAt(lon, lat),
            url: `https://waterlevel.ie${p.url}`
        });
    }

    // Forget stations that have disappeared from the feed
    for (const ref of Object.keys(history)) {
        if (!history[ref].length || new Date(history[ref][history[ref].length - 1][0]).getTime() < cutoff) delete history[ref];
    }
    state.write('river-history', history);

    const counties = {};
    for (const s of stations) {
        if (!s.county) continue;
        const c = counties[s.county] || (counties[s.county] = { stations: 0, rising: 0, risingFast: 0 });
        c.stations++;
        if (s.trend === 'rising') c.rising++;
        if (s.trend === 'rising-fast') { c.rising++; c.risingFast++; }
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, stations, counties };
}

module.exports = { fetchRivers };
