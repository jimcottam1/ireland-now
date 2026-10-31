// Met Éireann: what the weather stations actually measured in the last hour.
// The observations API takes a station slug and, for a slug it doesn't know, quietly answers with
// Dublin Airport's readings, so every answer is checked against the station name we asked for.
const { getJson } = require('../lib/http');
const { dublinToIso } = require('../lib/time');
const state = require('../lib/state');

const HISTORY_DAYS = 7;

/** "31-10-2026" + "20:00" (Irish time) -> ISO UTC */
const reportTime = r => {
    const [d, m, y] = String(r.date || '').split('-').map(Number);
    const [hh, mm] = String(r.reportTime || '').split(':').map(Number);
    return y && Number.isFinite(hh) ? dublinToIso(y, m, d, hh, mm || 0) : null;
};

const SOURCE = {
    name: 'Met Éireann weather observations',
    url: 'https://www.met.ie/latest-reports/observations',
    licence: 'CC BY 4.0'
};

// slug: [name as the API spells it, lat, lon, county]
const STATIONS = {
    athenry: ['Athenry', 53.289, -8.786, 'galway'],
    ballyhaise: ['Ballyhaise', 54.051, -7.310, 'cavan'],
    belmullet: ['Belmullet', 54.228, -10.007, 'mayo'],
    casement: ['Casement', 53.306, -6.439, 'dublin'],
    claremorris: ['Claremorris', 53.711, -8.993, 'mayo'],
    cork: ['Cork', 51.847, -8.486, 'cork'],
    dublinairport: ['Dublin Airport', 53.428, -6.241, 'dublin'],
    dunsany: ['Dunsany', 53.516, -6.660, 'meath'],
    finner: ['Finner', 54.494, -8.243, 'donegal'],
    gurteen: ['Gurteen', 53.052, -8.009, 'tipperary'],
    'johnstown-castle': ['Johnstown Castle', 52.298, -6.497, 'wexford'],
    knock: ['Knock', 53.906, -8.817, 'mayo'],
    'mace-head': ['Mace Head', 53.326, -9.904, 'galway'],
    'malin-head': ['Malin Head', 55.372, -7.339, 'donegal'],
    'markree-castle': ['Markree Castle', 54.175, -8.456, 'sligo'],
    'moore-park': ['Moore Park', 52.164, -8.264, 'cork'],
    mullingar: ['Mullingar', 53.537, -7.362, 'westmeath'],
    'oak-park': ['Oak Park', 52.861, -6.915, 'carlow'],
    'phoenix-park': ['Phoenix Park', 53.364, -6.350, 'dublin'],
    'roches-point': ["Roche's Point", 51.793, -8.244, 'cork'],
    shannon: ['Shannon', 52.690, -8.918, 'clare'],
    'sherkin-island': ['Sherkin Island', 51.476, -9.428, 'cork'],
    valentia: ['Valentia', 51.938, -10.241, 'kerry']
};

const num = v => {
    const n = parseFloat(String(v ?? '').trim());
    return Number.isFinite(n) ? n : null;
};

async function station(slug, [name, lat, lon, county]) {
    const rows = await getJson(`https://prodapi.met.ie/observations/${slug}/today`, { retries: 1 });
    // Hourly reports for today, in no guaranteed order; take the latest
    const mine = (rows || []).filter(r => r.name === name).sort((a, b) => a.reportTime.localeCompare(b.reportTime));
    if (!mine.length) return null;
    const r = mine[mine.length - 1];
    // Rain so far today: sum the hourly reports
    const rainToday = mine.reduce((sum, x) => sum + (num(x.rainfall) || 0), 0);
    return {
        id: slug,
        name,
        lat, lon, county,
        // Every hourly report today, merged into a week of history in fetchObservations
        today: mine.map(x => [reportTime(x), num(x.temperature), num(x.rainfall)]).filter(([t]) => t),
        reportedAt: reportTime(r),
        time: r.reportTime,
        date: r.date,
        temperature: num(r.temperature),
        description: r.weatherDescription || null,
        windKmh: num(r.windSpeed),
        gustKmh: num(r.windGust),
        windDirection: r.cardinalWindDirection || null,
        humidity: num(r.humidity),
        rainLastHour: num(r.rainfall),
        rainToday: Number(rainToday.toFixed(1)),
        pressure: num(r.pressure)
    };
}

async function fetchObservations() {
    const results = await Promise.allSettled(Object.entries(STATIONS).map(([slug, s]) => station(slug, s)));
    const stations = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    if (stations.length < 5) throw new Error(`Only ${stations.length} stations answered`);

    // A week of hourly readings per station: [time, temperature °C, rain mm in the hour]. Each run
    // brings all of today's reports, so a missed run fills itself in on the next one.
    const history = state.read('observation-history', {});
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
    for (const s of stations) {
        const byTime = new Map((history[s.id] || []).map(row => [row[0], row]));
        for (const row of s.today) byTime.set(row[0], row);
        history[s.id] = [...byTime.values()].filter(([t]) => t >= cutoff).sort((a, b) => a[0].localeCompare(b[0]));
        delete s.today;
    }
    for (const id of Object.keys(history)) if (!history[id].length || history[id][history[id].length - 1][0] < cutoff) delete history[id];
    state.write('observation-history', history);

    // Newest report from any station: how current Met Éireann's data is
    const sourceTime = stations.reduce((max, s) => (s.reportedAt > (max || '') ? s.reportedAt : max), null);

    // Each county's own station(s); counties without one show their nearest station in the browser
    const counties = {};
    for (const s of stations) (counties[s.county] = counties[s.county] || []).push(s.id);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime,
        stations,
        counties,
        // Loaded by the page only when a county is opened
        files: { 'observations/history.json': history }
    };
}

module.exports = { fetchObservations };
