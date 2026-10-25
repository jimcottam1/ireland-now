// National Transport Authority GTFS-Realtime: where every tracked bus is and how late it's running.
// Needs a free API key (NTA_API_KEY). The key allows about one request a minute, so the two feeds
// (positions, then delays) are fetched a minute apart.
const AdmZip = require('adm-zip');
const { getBuffer } = require('../lib/http');
const { countyAt } = require('../lib/geo');
const state = require('../lib/state');

const SOURCE = {
    name: 'NTA / Transport for Ireland GTFS-Realtime',
    url: 'https://developer.nationaltransport.ie/',
    licence: 'NTA open data licence'
};

const API = 'https://api.nationaltransport.ie/gtfsr/v2';
const GTFS = 'https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Fetch a realtime feed, waiting out the rate limit if the API asks us to. */
async function realtime(feed, key) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`${API}/${feed}?format=json`, {
            headers: { 'x-api-key': key, 'User-Agent': 'IrelandNow/1.0' },
            signal: AbortSignal.timeout(60000)
        });
        if (res.status === 429) {
            const body = await res.text();
            const wait = Number((body.match(/(\d+) seconds/) || [])[1] || 60);
            await sleep((wait + 2) * 1000);
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} from NTA ${feed}`);
        return res.json();
    }
    throw new Error(`NTA ${feed}: still rate limited`);
}

function csvRows(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const split = line => {
        const out = [];
        let field = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
            } else if (ch === '"') quoted = true; else if (ch === ',') { out.push(field); field = ''; } else field += ch;
        }
        out.push(field);
        return out;
    };
    const header = split(lines[0]);
    return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
}

/** Route numbers and operators from the static timetable (a large download, so refreshed weekly). */
async function routeNames() {
    return state.cached('bus-routes', 24 * 7, async () => {
        const zip = new AdmZip(await getBuffer(GTFS, { timeoutMs: 300000 }));
        const read = name => zip.readAsText(zip.getEntries().find(e => e.entryName.endsWith(name)));
        const agencies = Object.fromEntries(csvRows(read('agency.txt')).map(a => [a.agency_id, a.agency_name]));
        const routes = {};
        for (const r of csvRows(read('routes.txt'))) {
            routes[r.route_id] = { short: r.route_short_name, long: r.route_long_name, operator: agencies[r.agency_id] || '' };
        }
        return { updatedAt: new Date().toISOString(), routes };
    });
}

async function fetchBuses() {
    const key = process.env.NTA_API_KEY;
    if (!key) throw new Error('NTA_API_KEY is not set');

    const { routes } = await routeNames();
    const vehicles = await realtime('Vehicles', key);
    await sleep(61000); // one request a minute
    const updates = await realtime('TripUpdates', key);

    // Delay for each trip: the first upcoming stop's arrival (or departure) delay, in seconds
    const delays = new Map();
    for (const e of updates.entity || []) {
        const stu = e.trip_update?.stop_time_update?.[0];
        const delay = stu?.arrival?.delay ?? stu?.departure?.delay;
        if (e.trip_update?.trip?.trip_id && Number.isFinite(delay)) delays.set(e.trip_update.trip.trip_id, delay);
    }

    const buses = (vehicles.entity || []).map(e => {
        const v = e.vehicle;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const route = routes[v.trip?.route_id] || {};
        const delay = delays.get(v.trip?.trip_id);
        return {
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
            route: route.short || '',
            name: route.long || '',
            operator: route.operator || '',
            minutesLate: Number.isFinite(delay) ? Math.round(delay / 60) : null,
            county: countyAt(lon, lat)
        };
    }).filter(Boolean);

    const counties = {};
    for (const b of buses) {
        if (!b.county) continue;
        const c = counties[b.county] || (counties[b.county] = { buses: 0, late: 0 });
        c.buses++;
        if (b.minutesLate >= 5) c.late++;
    }
    const known = buses.filter(b => b.minutesLate != null);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        buses,
        counties,
        national: {
            running: buses.length,
            late: buses.filter(b => b.minutesLate >= 5).length,
            averageDelay: known.length ? Number((known.reduce((s, b) => s + Math.max(0, b.minutesLate), 0) / known.length).toFixed(1)) : null
        }
    };
}

module.exports = { fetchBuses };
