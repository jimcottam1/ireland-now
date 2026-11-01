// Dublin Bikes: every station and how many bikes and free stands it has. JCDecaux open data API v1
// (needs a free API key, JCDECAUX_API_KEY). The key travels in the query string, as the API requires,
// so errors must never include the URL: lib/http reports only the host.
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'JCDecaux open data (Dublin Bikes)',
    url: 'https://developer.jcdecaux.com/',
    licence: 'JCDecaux Open Licence'
};

const API = 'https://api.jcdecaux.com/vls/v1/stations';

async function fetchBikes() {
    const key = process.env.JCDECAUX_API_KEY;
    if (!key) throw new Error('JCDECAUX_API_KEY is not set');

    const list = await getJson(`${API}?contract=dublin&apiKey=${encodeURIComponent(key)}`, { timeoutMs: 30000 });
    if (!Array.isArray(list)) throw new Error('Dublin Bikes: unexpected response');
    if (!list.length) throw new Error('Dublin Bikes: no stations');

    const num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
    const stations = [];
    let newest = 0;
    for (const s of list) {
        const lat = s?.position?.lat;
        const lon = s?.position?.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (Number.isFinite(s.last_update) && s.last_update > newest) newest = s.last_update;
        stations.push({
            id: s.number,
            name: String(s.name || '').trim(),
            lat, lon,
            bikes: num(s.available_bikes),
            stands: num(s.available_bike_stands),
            capacity: num(s.bike_stands),
            open: s.status === 'OPEN'
        });
    }
    if (!stations.length) throw new Error('Dublin Bikes: no stations with a position');
    if (!newest) throw new Error('Dublin Bikes: no usable update time');

    // Closed stations offer nothing, so they add no bikes or stands to the totals
    const openOnes = stations.filter(s => s.open);
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: new Date(newest).toISOString(),
        stations,
        totals: {
            bikes: openOnes.reduce((n, s) => n + s.bikes, 0),
            stands: openOnes.reduce((n, s) => n + s.stands, 0),
            stations: stations.length,
            open: openOnes.length
        }
    };
}

module.exports = { fetchBikes, SOURCE };
