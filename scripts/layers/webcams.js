// Webcams: public webcams on the island of Ireland from the Windy.com Webcams API v3 (needs a free key,
// WINDY_API_KEY, sent in a header). We keep only each camera's name, place, position, Windy page and the time
// its image last changed, plus Windy's embeddable player. No image links: free-tier ones expire after 10 minutes,
// far sooner than our hourly build. The player link carries no key or token, so the page can open it on demand.
const http = require('../lib/http');
const { countyAt } = require('../lib/geo');

const SOURCE = {
    name: 'Windy.com Webcams',
    url: 'https://www.windy.com/webcams',
    licence: 'Windy Webcams API terms',
    licenceUrl: 'https://api.windy.com/webcams/terms'
};

const API = 'https://api.windy.com/webcams/api/v3/webcams';
// The island of Ireland: north, east, south, west. Cams just over the sea (Wales, Scotland) fall outside every county.
const BBOX = '55.5,-5.3,51.3,-10.8';
const PAGE = 50;          // the API's largest page
const MAX_PAGES = 10;     // far more than Ireland has; stops a runaway loop

const DIRECTION = /\s*›\s*((?:north|south)(?:-(?:east|west))?|east|west)\s*$/i;

/** Tidy a Windy place segment: "The Municipal District of Arklow" -> "Arklow", "Churchtown-Orwell DED 1986" -> "Churchtown-Orwell". */
function tidyPlace(text) {
    return String(text || '')
        .replace(/^(the )?municipal district of /i, '')
        .replace(/ (municipal|metropolitan|city metropolitan) (borough )?district\b.*$/i, '')
        .replace(/ D?ED( \d{4})?\b/g, '')
        .replace(/ - (munster|leinster|connacht|ulster)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Windy titles are built from district names, e.g. "Kenmare Municipal District: Caherdaniel ED: Derrynane".
 * Name: the last part ("Derrynane"). Place: the first part, tidied ("Kenmare"), unless it repeats the name.
 * A lone part with a compass direction becomes "Howth, looking north".
 */
function tidyName(title) {
    const parts = String(title || '').split(':').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return { name: 'Webcam', place: null };
    const last = parts[parts.length - 1];
    const dir = last.match(DIRECTION);
    let name = tidyPlace(last.replace(DIRECTION, ''));
    if (dir && name) name += `, looking ${dir[1].toLowerCase()}`;
    let place = parts.length > 1 ? tidyPlace(parts[0].replace(DIRECTION, '')) : null;
    if (!place || name.toLowerCase().includes(place.toLowerCase())) place = null;
    return { name: name || 'Webcam', place };
}

/** Only ever link to Windy itself. */
function windyLink(url, id) {
    return /^https:\/\/(www\.)?windy\.com\/webcams\/\d+$/.test(url || '') ? url : `https://www.windy.com/webcams/${id}`;
}

/** Windy's embeddable day player (latest picture plus a timelapse of the day), only for this same camera. */
function playerLink(url, id) {
    const m = String(url || '').match(/^https:\/\/webcams\.windy\.com\/webcams\/public\/embed\/player\/(\d+)\/day$/);
    return m && Number(m[1]) === id ? url : null;
}

async function fetchPage(key, offset) {
    const params = new URLSearchParams({ bbox: BBOX, limit: String(PAGE), offset: String(offset), include: 'location,urls,player' });
    const answer = await http.getJson(`${API}?${params}`, { timeoutMs: 30000, headers: { 'x-windy-api-key': key } });
    if (!answer || !Number.isFinite(answer.total) || !Array.isArray(answer.webcams)) throw new Error('Webcams: unexpected response from Windy');
    return answer;
}

async function fetchWebcams() {
    const key = process.env.WINDY_API_KEY;
    if (!key) throw new Error('WINDY_API_KEY is not set');

    const raw = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await fetchPage(key, page * PAGE);
        raw.push(...answer.webcams);
        if ((page + 1) * PAGE >= answer.total) break;
    }
    if (!raw.length) throw new Error('Webcams: Windy returned no webcams');

    const webcams = [];
    const seen = new Set();
    for (const w of raw) {
        const id = w?.webcamId;
        const lat = w?.location?.latitude;
        const lon = w?.location?.longitude;
        if (!Number.isFinite(id) || seen.has(id) || w.status !== 'active') continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const county = countyAt(lon, lat);
        if (!county) continue;
        const updated = Date.parse(w.lastUpdatedOn);
        seen.add(id);
        webcams.push({
            id,
            ...tidyName(w.title),
            county,
            lat, lon,
            url: windyLink(w.urls?.detail, id),
            player: playerLink(w.player?.day, id),
            updated: Number.isFinite(updated) ? new Date(updated).toISOString() : null
        });
    }
    if (!webcams.length) throw new Error('Webcams: none in an Irish county');
    const times = webcams.map(w => w.updated).filter(Boolean).sort();
    if (!times.length) throw new Error('Webcams: no usable image update time');
    webcams.sort((a, b) => a.county.localeCompare(b.county) || a.name.localeCompare(b.name));

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: times[times.length - 1],
        webcams
    };
}

module.exports = { fetchWebcams, tidyName, SOURCE };
