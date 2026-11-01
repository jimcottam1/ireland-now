// RNLI lifeboat launches on the island of Ireland.
// Launches: services.rnli.org/api/launches (the RNLI's own launch feed, no key; it has no robots.txt,
// and the site is not covered by any bot restrictions). It holds only the latest ~20 launches across
// the whole UK and Ireland (about a day), so we remember each launch between runs for seven days.
// Positions: the RNLI Lifeboat Station Locations feature service on RNLI Open Data (GIS Open Data Licence).
// The feed has no coordinates, so launches are joined to stations by name.
const { getJson } = require('../lib/http');
const { dublinToIso } = require('../lib/time');
const { countyAt, countyFromName } = require('../lib/geo');
const state = require('../lib/state');

const SOURCE = {
    name: 'RNLI launches and RNLI Open Data lifeboat station locations',
    url: 'https://data-rnli.opendata.arcgis.com/',
    licence: 'Contains Open Data licensed under the GIS Open Data Licence (station locations); launch feed from the RNLI'
};

const LAUNCHES_URL = 'https://services.rnli.org/api/launches';
const STATIONS_URL = 'https://services1.arcgis.com/evM5NkxAYjTi6XPw/arcgis/rest/services/RNLI_Lifeboat_Station_locations/FeatureServer/0/query'
    + '?where=1%3D1&outFields=StationType,County,Country,Station,URL,Lat,Long,FuncLocId&returnGeometry=false&f=json';
const STATION_CACHE_HOURS = 24 * 30;
const WEEK_MS = 7 * 24 * 3600000;
const MIN_IRISH_STATIONS = 40; // the RNLI runs 46 on the island; far fewer means the list is wrong

/** "Dún Laoghaire", "Bangor (Co Down)" -> "dun laoghaire", "bangor" */
const nameKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The feed's launchDate has no zone. It is the RNLI's UK local time (an ASP.NET service stamping
 * local time; in winter that is the same as UTC). UK and Irish clocks change on the same dates,
 * so the Irish converter is exact.
 */
function launchToIso(text) {
    const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const iso = dublinToIso(year, month, day, hour, minute);
    return iso ? new Date(Date.parse(iso) + second * 1000).toISOString() : null;
}

async function loadStations() {
    return state.cached('rnli-stations', STATION_CACHE_HOURS, async () => {
        const json = await getJson(STATIONS_URL, { timeoutMs: 30000 });
        if (!json || !Array.isArray(json.features)) throw new Error('RNLI: unexpected station list');
        const stations = [];
        for (const f of json.features) {
            const a = f && f.attributes;
            if (!a || !/^(IRL|NIR)$/.test(a.Country)) continue;
            const lat = Number(a.Lat);
            const lon = Number(a.Long);
            if (!a.Station || !a.FuncLocId || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const county = countyAt(lon, lat);
            if (!county) continue;
            stations.push({ id: String(a.FuncLocId), name: String(a.Station).trim(), lat, lon, county, url: /^https:\/\/rnli\.org\//.test(a.URL || '') ? a.URL : null });
        }
        if (stations.length < MIN_IRISH_STATIONS) throw new Error(`RNLI: only ${stations.length} Irish stations in the list`);
        return { updatedAt: new Date().toISOString(), stations };
    });
}

function parseLaunches(json) {
    if (!Array.isArray(json) || !json.length) throw new Error('RNLI: unexpected launches feed');
    return json.map(l => {
        const time = launchToIso(l && l.launchDate);
        if (!time || !l.shortName || !Number.isInteger(l.id)) throw new Error('RNLI: unrecognised launch record');
        return { id: l.id, name: String(l.shortName), title: String(l.title || ''), website: String(l.website || ''), time };
    });
}

async function fetchRnli() {
    const { stations: list } = await loadStations();
    const launches = parseLaunches(await getJson(LAUNCHES_URL, { timeoutMs: 30000 }));
    const now = Date.now();

    const byKey = new Map(list.map(s => [nameKey(s.name), s]));
    const stationFor = l => byKey.get(nameKey(l.name)) || byKey.get(nameKey(l.title.split(',')[0]));

    // Remember the Irish launches we have seen (the feed only keeps about a day)
    const history = state.read('rnli-history') || { since: new Date(now).toISOString(), launches: [] };
    const known = new Map(history.launches.map(l => [l.id, l]));
    for (const l of launches) {
        const station = stationFor(l);
        if (station) known.set(l.id, { id: l.id, station: station.id, time: l.time, website: l.website });
        else if (/\bCo\.?\s/i.test(l.title) && countyFromName(l.title)) console.warn(`RNLI: no station matched "${l.title}"`);
    }
    const kept = [...known.values()].filter(l => now - Date.parse(l.time) < WEEK_MS);
    const next = { since: history.since, launches: kept };

    const stations = list.map(s => {
        const mine = kept.filter(l => l.station === s.id).sort((a, b) => b.time.localeCompare(a.time));
        const website = (mine.find(l => l.website) || {}).website;
        return {
            id: s.id, name: s.name, lat: s.lat, lon: s.lon, county: s.county,
            url: website ? `https://${website.replace(/^https?:\/\//, '')}` : s.url,
            launches: mine.map(l => l.time)
        };
    });
    const counties = {};
    for (const s of stations) counties[s.county] = { launches7d: (counties[s.county]?.launches7d || 0) + s.launches.length };

    const sourceTime = launches.reduce((best, l) => (l.time > best ? l.time : best), launches[0].time);
    state.write('rnli-history', next);
    return { updatedAt: new Date(now).toISOString(), source: SOURCE, sourceTime, recordingSince: next.since, stations, counties };
}

module.exports = { fetchRnli, SOURCE };
