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
    licenceUrl: 'https://www.arcgis.com/home/item.html?id=7dad2e58254345c08dfde737ec348166', // the item page carries the licence text
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
    if (hour > 23 || minute > 59 || second > 59) return null;
    // 31 June would roll into July: the date must survive a round trip
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    const iso = dublinToIso(year, month, day, hour, minute);
    return iso ? new Date(Date.parse(iso) + second * 1000).toISOString() : null;
}
// ASSUMPTION to verify next summer (late March to October): launchDate is UK local time, not UTC.
// getJson does not expose response headers, so we cannot compare against the server's Date header.
// To check: after a launch during British Summer Time, compare the feed's time with the same launch on
// the station's page or news post. If the feed is an hour behind local time, it is UTC; swap
// dublinToIso for a plain UTC parse.

const validTime = t => typeof t === 'string' && !Number.isNaN(Date.parse(t));
const FUTURE_SLACK_MS = 3600000;

async function loadStations() {
    try {
        return await freshStations();
    } catch (error) {
        // An ArcGIS outage must not stop us recording launches: use the expired list if it is still sound
        const old = state.read('cache-rnli-stations');
        const ok = old && Array.isArray(old.stations) && old.stations.length >= MIN_IRISH_STATIONS
            && old.stations.every(s => s && s.id && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.county);
        if (!ok) throw error;
        console.warn(`RNLI: station list refresh failed (${error.message}); using the copy from ${old.updatedAt}`);
        return old;
    }
}

async function freshStations() {
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

function parseLaunches(json, now) {
    if (!Array.isArray(json) || !json.length) throw new Error('RNLI: unexpected launches feed');
    return json.map(l => {
        const time = launchToIso(l && l.launchDate);
        if (!time || !l.shortName || !Number.isInteger(l.id)) throw new Error('RNLI: unrecognised launch record');
        // A launch in the future would become the feed's "newest" time and hide a stale feed
        if (Date.parse(time) > now + FUTURE_SLACK_MS) throw new Error(`RNLI: launch dated in the future (${l.launchDate})`);
        return {
            id: l.id, name: String(l.shortName), title: String(l.title || ''), website: String(l.website || ''), time,
            code: Number.isInteger(l.cOACS) ? l.cOACS : null
        };
    });
}

/** The remembered history, or null when it is missing or damaged */
function readHistory() {
    const h = state.read('rnli-history');
    if (!h || !validTime(h.since) || !validTime(h.lastNewest) || !Array.isArray(h.launches)) return null;
    const launches = h.launches.filter(l => l && Number.isInteger(l.id) && l.station && validTime(l.time));
    const codes = h.codes && typeof h.codes === 'object' && !Array.isArray(h.codes) ? h.codes : {};
    return { since: h.since, lastNewest: h.lastNewest, launches, codes };
}

async function fetchRnli() {
    const { stations: list } = await loadStations();
    const now = Date.now();
    const launches = parseLaunches(await getJson(LAUNCHES_URL, { timeoutMs: 30000 }), now);
    const oldest = launches.reduce((best, l) => (l.time < best ? l.time : best), launches[0].time);
    const sourceTime = launches.reduce((best, l) => (l.time > best ? l.time : best), launches[0].time);

    const byKey = new Map(list.map(s => [nameKey(s.name), s]));
    const byId = new Map(list.map(s => [s.id, s]));

    // Remember the Irish launches we have seen (the feed only keeps about a day)
    let history = readHistory();
    let since;
    if (!history) {
        // The feed already holds up to a day of launches, which we count, so recording starts then
        history = { launches: [], codes: {} };
        since = oldest < new Date(now).toISOString() ? oldest : new Date(now).toISOString();
    } else if (oldest > history.lastNewest) {
        // Every launch in the feed is newer than the last one we saw: runs were missed and launches lost
        since = oldest;
        console.warn(`RNLI: gap in coverage (last run saw launches up to ${history.lastNewest}, the feed now starts at ${oldest})`);
    } else {
        since = history.since;
    }

    const codes = { ...history.codes };
    const known = new Map(history.launches.map(l => [l.id, l]));
    const unmatched = [];
    for (const l of launches) {
        // The feed's code is stable, so once a name has matched we can join on the code
        const station = byKey.get(nameKey(l.name)) || byKey.get(nameKey(l.title.split(',')[0])) || byId.get(codes[l.code]);
        if (station) {
            known.set(l.id, { id: l.id, station: station.id, time: l.time, website: l.website });
            if (l.code != null) codes[l.code] = station.id;
        } else if (countyFromName(l.title) || countyFromName(l.name)) {
            unmatched.push(l.title || l.name);
        }
    }
    const unmatchedIrish = { count: unmatched.length, names: [...new Set(unmatched)].sort() };
    for (const name of unmatchedIrish.names) console.warn(`RNLI: no station matched "${name}"`);
    console.log(`RNLI: ${unmatchedIrish.count} unmatched Irish launches${unmatchedIrish.count ? ` (${unmatchedIrish.names.join('; ')})` : ''}`);

    const kept = [...known.values()].filter(l => now - Date.parse(l.time) < WEEK_MS);

    const stations = list.map(s => {
        const mine = kept.filter(l => l.station === s.id).sort((a, b) => b.time.localeCompare(a.time));
        const website = (mine.find(l => l.website) || {}).website;
        return {
            id: s.id, name: s.name, lat: s.lat, lon: s.lon, county: s.county,
            // The checked station-list link first; the feed's value only if that is missing
            url: s.url || (/^(https?:\/\/)?([a-z0-9-]+\.)*rnli\.org\//i.test(website || '') ? `https://${website.replace(/^https?:\/\//, '')}` : null),
            launches: mine.map(l => l.time)
        };
    });
    const counties = {};
    for (const s of stations) counties[s.county] = { launches7d: (counties[s.county]?.launches7d || 0) + s.launches.length };

    state.write('rnli-history', { since, lastNewest: sourceTime, launches: kept, codes });
    return { updatedAt: new Date(now).toISOString(), source: SOURCE, sourceTime, recordingSince: since, unmatchedIrish, stations, counties };
}

module.exports = { fetchRnli, SOURCE };
