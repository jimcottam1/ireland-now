// Luas line status and stops. The Luas forecast feed (luasforecasts.rpa.ie, no key, no robots.txt
// restrictions) lists every stop, and each stop's forecast carries a line-wide status message.
// We keep only the message: tram times would be stale within the hour.
const { getText } = require('../lib/http');
const { dublinToIso } = require('../lib/time');

const SOURCE = {
    name: 'Luas (Transport Infrastructure Ireland) forecast feed',
    url: 'https://luasforecasts.rpa.ie/',
    licence: 'Public Luas service information'
};

const BASE = 'https://luasforecasts.rpa.ie/xml/get.ashx';
// A central stop on each line, used to read the line-wide message
const CENTRAL = { red: 'ABB', green: 'STS' };

const unescapeXml = s => String(s || '').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const attr = (tag, name) => unescapeXml((tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1]);

/** "2026-11-01T20:57:24" (Irish local time) -> ISO UTC */
function createdToIso(text) {
    const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? dublinToIso(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) : null;
}

function parseStops(xml) {
    const stops = [];
    const lineRe = /<line\s+name="([^"]*)"\s*>([\s\S]*?)<\/line>/g;
    let lm;
    while ((lm = lineRe.exec(xml))) {
        const lineName = unescapeXml(lm[1]);
        const id = /red/i.test(lineName) ? 'red' : /green/i.test(lineName) ? 'green' : null;
        if (!id) continue;
        const stopRe = /<stop\s([^>]*)>([^<]*)<\/stop>/g;
        let sm;
        while ((sm = stopRe.exec(lm[2]))) {
            const lat = Number(attr(sm[1], 'lat'));
            const lon = Number(attr(sm[1], 'long'));
            const code = attr(sm[1], 'abrev');
            const name = unescapeXml(sm[2]).trim();
            if (!code || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            stops.push({
                line: id, code, name, lat, lon,
                parkRide: attr(sm[1], 'isParkRide') === '1',
                cycleRide: attr(sm[1], 'isCycleRide') === '1'
            });
        }
    }
    return stops;
}

function parseForecast(xml) {
    const info = (xml.match(/<stopInfo\s[^>]*>/) || [])[0];
    const message = unescapeXml((xml.match(/<message>([\s\S]*?)<\/message>/) || [])[1]).replace(/\s+/g, ' ').trim();
    return { message, created: info ? createdToIso(attr(info, 'created')) : null };
}

async function fetchLuas() {
    const stops = parseStops(await getText(`${BASE}?action=stops&encrypt=false`, { timeoutMs: 30000 }));
    const ids = ['red', 'green'];
    for (const id of ids) {
        if (!stops.some(s => s.line === id)) throw new Error(`Luas: no ${id} line stops found`);
    }

    const names = { red: 'Red Line', green: 'Green Line' };
    const lines = {};
    let sourceTime = null;
    for (const id of ids) {
        const code = stops.some(s => s.code === CENTRAL[id]) ? CENTRAL[id] : stops.find(s => s.line === id).code;
        const { message, created } = parseForecast(await getText(`${BASE}?action=forecast&stop=${code}&encrypt=false`, { timeoutMs: 30000 }));
        if (!message) throw new Error(`Luas: no status message for the ${id} line`);
        if (created && (!sourceTime || created > sourceTime)) sourceTime = created;
        lines[id] = { name: names[id], message, normal: /operating normally/i.test(message) };
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime, lines, stops };
}

module.exports = { fetchLuas, SOURCE };
