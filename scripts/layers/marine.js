// Marine Institute weather buoys (Irish Weather Buoy Network, M2–M6): wind, waves and sea temperature.
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'Marine Institute, Irish Weather Buoy Network',
    url: 'https://www.marine.ie/site-area/data-services/real-time-observations/irish-weather-buoy-network',
    licence: 'CC BY 4.0'
};

// Where each buoy is, for the popup
const PLACES = {
    M2: 'Irish Sea, east of Howth',
    M3: 'Atlantic, southwest of Mizen Head',
    M4: 'Atlantic, off Donegal Bay',
    M5: 'Celtic Sea, off Hook Head',
    M6: 'Atlantic, west of the Porcupine Bank',
    FS1: 'Celtic Sea'
};

const KNOTS_TO_KMH = 1.852;
const round = (v, dp = 1) => v == null || Number.isNaN(v) ? null : Number(v.toFixed(dp));

async function fetchMarine() {
    const since = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 19) + 'Z';
    const url = 'https://erddap.marine.ie/erddap/tabledap/IWBNetwork.json'
        + '?station_id,time,longitude,latitude,AtmosphericPressure,WindDirection,WindSpeed,Gust,WaveHeight,WavePeriod,SeaTemperature,AirTemperature'
        + `&time%3E=${since}`;
    const raw = await getJson(url, { timeoutMs: 60000 });

    // Latest row per buoy (a buoy can drop single readings, so keep the newest non-empty one)
    const latest = new Map();
    for (const [id, time, lon, lat, pressure, windDir, wind, gust, wave, period, sea, air] of raw.table.rows) {
        if (lat == null) continue;
        const prev = latest.get(id);
        if (prev && prev.time > time) continue;
        latest.set(id, { id, time, lon, lat, pressure, windDir, wind, gust, wave, period, sea, air });
    }

    const buoys = [...latest.values()].map(b => ({
        id: b.id,
        name: `${b.id} buoy`,
        place: PLACES[b.id] || 'Irish waters',
        lat: round(b.lat, 4),
        lon: round(b.lon, 4),
        time: b.time,
        windKmh: b.wind == null ? null : Math.round(b.wind * KNOTS_TO_KMH),
        gustKmh: b.gust == null ? null : Math.round(b.gust * KNOTS_TO_KMH),
        windDirection: b.windDir,
        waveHeight: round(b.wave),
        wavePeriod: round(b.period),
        seaTemperature: round(b.sea),
        airTemperature: round(b.air),
        pressure: b.pressure == null ? null : Math.round(b.pressure)
    })).sort((a, b) => a.id.localeCompare(b.id));

    if (!buoys.length) throw new Error('No buoy readings in the last 6 hours');
    return { updatedAt: new Date().toISOString(), source: SOURCE, buoys };
}

module.exports = { fetchMarine };
