// Earthquakes in and around Ireland in the last year, from the EMSC (European-Mediterranean Seismological
// Centre). It includes the small quakes the Irish National Seismic Network (INSN) records, which global
// catalogues such as USGS miss.
const { getJson } = require('../lib/http');
const { countyAt } = require('../lib/geo');

const SOURCE = {
    name: 'EMSC Seismic Portal (with INSN data)',
    url: 'https://www.seismicportal.eu/',
    licence: 'CC BY 4.0'
};

// Ireland and its near waters
const BOX = { minlat: 51.2, maxlat: 55.6, minlon: -11.0, maxlon: -5.3 };

async function fetchEarthquakes() {
    const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({ format: 'json', ...BOX, starttime: start, limit: '200', orderby: 'time' });
    const raw = await getJson(`https://www.seismicportal.eu/fdsnws/event/1/query?${params}`, { timeoutMs: 45000 });

    const quakes = (raw.features || []).map(({ properties: p }) => ({
        id: p.unid,
        time: p.time,
        lat: Number(p.lat.toFixed(3)),
        lon: Number(p.lon.toFixed(3)),
        depthKm: p.depth == null ? null : Math.abs(p.depth),
        magnitude: p.mag,
        region: p.flynn_region,
        agency: p.auth,
        county: countyAt(p.lon, p.lat),
        url: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(p.unid)}`
    })).sort((a, b) => b.time.localeCompare(a.time));

    return { updatedAt: new Date().toISOString(), source: SOURCE, quakes };
}

module.exports = { fetchEarthquakes };
