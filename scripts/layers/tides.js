// Marine Institute tide gauges (Irish National Tide Gauge Network): latest level and whether it's rising.
const { getJson } = require('../lib/http');
const { countyAt } = require('../lib/geo');

const SOURCE = {
    name: 'Marine Institute, Irish National Tide Gauge Network',
    url: 'https://www.marine.ie/site-area/data-services/real-time-observations/irish-national-tide-gauge-network',
    licence: 'CC BY 4.0'
};

async function fetchTides() {
    const since = new Date(Date.now() - 2 * 3600000).toISOString().slice(0, 19) + 'Z';
    const url = 'https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.json'
        + '?station_id,latitude,longitude,time,Water_Level_LAT'
        + `&time%3E=${since}`;
    const raw = await getJson(url, { timeoutMs: 60000 });

    // Rows are readings from every gauge; group them by station
    const byStation = new Map();
    for (const [station, lat, lon, time, level] of raw.table.rows) {
        if (level === null || lat === null) continue;
        if (!byStation.has(station)) byStation.set(station, { lat, lon, readings: [] });
        byStation.get(station).readings.push([time, level]);
    }

    const gauges = [];
    for (const [name, { lat, lon, readings }] of byStation) {
        readings.sort((a, b) => a[0].localeCompare(b[0]));
        const [time, level] = readings[readings.length - 1];
        // Compare with a reading about 30 minutes earlier to tell the direction of the tide
        const earlier = readings.filter(([t]) => new Date(time) - new Date(t) >= 25 * 60000).pop();
        const change = earlier ? level - earlier[1] : null;
        gauges.push({
            name,
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4)),
            level: Number(level.toFixed(2)),
            time,
            direction: change === null ? 'unknown' : change > 0.02 ? 'rising' : change < -0.02 ? 'falling' : 'turning',
            county: countyAt(lon, lat)
        });
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, gauges };
}

module.exports = { fetchTides };
