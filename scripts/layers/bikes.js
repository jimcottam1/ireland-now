// Dublin Bikes: every station and how many bikes and free stands it has. JCDecaux open data API v1
// (needs a free API key, JCDECAUX_API_KEY). The key travels in the query string, as the API requires,
// so errors must never include the URL: lib/http reports only the host.
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'JCDecaux open data (Dublin Bikes)',
    url: 'https://developer.jcdecaux.com/',
    licence: 'Licence Ouverte / Open Licence (per JCDecaux developer terms)',
    // The exact licence version is unconfirmed: the terms page is a single-page app we could not read
    licenceUrl: 'https://developer.jcdecaux.com/#/opendata/license'
};

const API = 'https://api.jcdecaux.com/vls/v1/stations';

async function fetchBikes() {
    const key = process.env.JCDECAUX_API_KEY;
    if (!key) throw new Error('JCDECAUX_API_KEY is not set');

    const list = await getJson(`${API}?contract=dublin&apiKey=${encodeURIComponent(key)}`, { timeoutMs: 30000 });
    if (!Array.isArray(list)) throw new Error('Dublin Bikes: unexpected response');
    if (!list.length) throw new Error('Dublin Bikes: no stations');

    const count = v => Number.isFinite(v) && v >= 0;
    let badCounts = 0;
    const stations = [];
    let newest = 0;
    for (const s of list) {
        const lat = s?.position?.lat;
        const lon = s?.position?.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        // A missing or renamed count must not turn into a believable 0
        if (![s.available_bikes, s.available_bike_stands, s.bike_stands].every(count)) { badCounts++; continue; }
        if (Number.isFinite(s.last_update) && s.last_update > newest) newest = s.last_update;
        stations.push({
            id: s.number,
            name: String(s.name || '').trim(),
            lat, lon,
            bikes: s.available_bikes,
            stands: s.available_bike_stands,
            capacity: s.bike_stands,
            open: s.status === 'OPEN'
        });
    }
    if (!stations.length) throw new Error('Dublin Bikes: no stations with a position and counts');
    if (badCounts > stations.length) throw new Error(`Dublin Bikes: ${badCounts} stations had no usable counts`);
    if (!newest) throw new Error('Dublin Bikes: no usable update time');

    // Closed stations offer nothing, so they add no bikes or stands to the totals
    const openOnes = stations.filter(s => s.open);
    const totalBikes = openOnes.reduce((n, s) => n + s.bikes, 0);
    const totalStands = openOnes.reduce((n, s) => n + s.stands, 0);
    if (openOnes.length && !totalBikes && !totalStands) throw new Error('Dublin Bikes: every open station shows 0 bikes and 0 stands');
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: new Date(newest).toISOString(),
        stations,
        totals: {
            bikes: totalBikes,
            stands: totalStands,
            stations: stations.length,
            open: openOnes.length
        }
    };
}

module.exports = { fetchBikes, SOURCE };
