// Webcams: Windy.com webcams on the island of Ireland, read from a trimmed sample of a real Windy API v3 answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

const KEY = 'test-windy-key';
const withKey = fn => async t => {
    const old = process.env.WINDY_API_KEY;
    process.env.WINDY_API_KEY = KEY;
    try { await fn(t); } finally { if (old === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = old; }
};
const API = /api\.windy\.com\/webcams\/api\/v3\/webcams/;
const sample = () => JSON.parse(fixture('windy-webcams.json'));

test('active webcams in Irish counties, with tidy names and Windy links', withKey(async () => {
    const urls = [];
    mockHttp([[API, url => { urls.push(url); return sample(); }]]);
    const d = await loadLayer('webcams').fetchWebcams();

    assert.equal(urls.length, 1, 'one page is enough when total fits');
    assert.match(urls[0], /bbox=/);
    assert.match(urls[0], /include=location%2Curls|include=location,urls/);
    assert.ok(!urls[0].includes(KEY), 'the key travels in a header, never the URL');

    const ids = d.webcams.map(w => w.id).sort();
    // Wales (St Davids) is outside every county; the inactive camera is dropped
    assert.deepEqual(ids, [1250613112, 1321017273, 1574367301, 1613986305, 1620598588, 1672752907].sort());

    const byId = Object.fromEntries(d.webcams.map(w => [w.id, w]));
    assert.equal(byId[1250613112].county, 'kerry');
    assert.equal(byId[1250613112].name, 'Derrynane');
    assert.equal(byId[1250613112].place, 'Kenmare');
    assert.equal(byId[1613986305].county, 'dublin');
    assert.equal(byId[1613986305].name, 'GPO Museum');
    assert.equal(byId[1672752907].name, 'Howth, looking north');
    assert.equal(byId[1672752907].place, null);
    assert.equal(byId[1574367301].name, 'Killarney');
    assert.equal(byId[1574367301].place, null, 'a place the same as the name is not repeated');
    assert.equal(byId[1321017273].name, 'Weather Cam');
    assert.equal(byId[1321017273].place, 'Moycullen');
    assert.equal(byId[1620598588].county, 'down', 'Northern Ireland cams are included');

    const w = byId[1250613112];
    assert.equal(w.url, 'https://windy.com/webcams/1250613112');
    assert.equal(w.lat, 51.74627);
    assert.equal(w.lon, -10.12836);
    assert.equal(w.updated, '2026-11-08T20:36:36.000Z');
    assert.equal(w.player, 'https://webcams.windy.com/webcams/public/embed/player/1250613112/day');
    assert.equal(Object.keys(w).length, 9, 'no image URLs or other extras are kept');
}));

test('asks for the embeddable player, and keeps only a Windy player for the same camera', withKey(async () => {
    let url;
    const s = sample();
    s.webcams[0].player.day = 'https://evil.example/embed/player/1250613112/day';
    s.webcams[1].player.day = 'https://webcams.windy.com/webcams/public/embed/player/999/day';   // another camera's player
    delete s.webcams[2].player;
    mockHttp([[API, u => { url = u; return s; }]]);
    const d = await loadLayer('webcams').fetchWebcams();
    assert.match(decodeURIComponent(url), /include=[^&]*player/);
    const byId = Object.fromEntries(d.webcams.map(w => [w.id, w]));
    assert.equal(byId[1250613112].player, null);
    assert.equal(byId[1613986305].player, null);
    assert.equal(byId[1321017273].player, null);
    assert.equal(byId[1672752907].player, 'https://webcams.windy.com/webcams/public/embed/player/1672752907/day');
}));

test('tidy names for the title shapes Windy uses', () => {
    const { tidyName } = loadLayer('webcams');
    assert.deepEqual(tidyName('West Clare Municipal District: Ennistimon › West'), { name: 'Ennistimon, looking west', place: 'West Clare' });
    assert.deepEqual(tidyName('Waterford City Metropolitan District: Tramore'), { name: 'Tramore', place: 'Waterford' });
    assert.deepEqual(tidyName('The Municipal District of Arklow › South-west'), { name: 'Arklow, looking south-west', place: null });
    assert.deepEqual(tidyName('Churchtown-Orwell DED 1986 › West'), { name: 'Churchtown-Orwell, looking west', place: null });
    assert.deepEqual(tidyName('Sligo Municipal Borough District: Knockaree ED: Strandhill Beach'), { name: 'Strandhill Beach', place: 'Sligo' });
    assert.deepEqual(tidyName(''), { name: 'Webcam', place: null });
});

test('sourceTime is the newest image update', withKey(async () => {
    mockHttp([[API, sample()]]);
    const d = await loadLayer('webcams').fetchWebcams();
    const newest = d.webcams.map(w => w.updated).sort().pop();
    assert.equal(d.sourceTime, newest);
}));

test('reads every page when there are more than 50', withKey(async () => {
    const all = sample();
    const offsets = [];
    mockHttp([[API, url => {
        const offset = Number(new URL(url).searchParams.get('offset') || 0);
        offsets.push(offset);
        // Pretend there are 120 cams: page 1 and 2 hold the sample, page 3 is empty-handed but finishes the total
        return { total: 120, webcams: offset < 100 ? all.webcams : [] };
    }]]);
    await loadLayer('webcams').fetchWebcams();
    assert.deepEqual(offsets, [0, 50, 100]);
}));

test('a link that is not on windy.com is replaced by the standard Windy page', withKey(async () => {
    const s = sample();
    s.webcams[0].urls.detail = 'https://example.com/phish';
    mockHttp([[API, s]]);
    const d = await loadLayer('webcams').fetchWebcams();
    assert.equal(d.webcams.find(w => w.id === 1250613112).url, 'https://www.windy.com/webcams/1250613112');
}));

test('a missing key throws before any request', async () => {
    const old = process.env.WINDY_API_KEY;
    delete process.env.WINDY_API_KEY;
    try {
        mockHttp([]);
        await assert.rejects(loadLayer('webcams').fetchWebcams(), /WINDY_API_KEY is not set/);
    } finally { if (old !== undefined) process.env.WINDY_API_KEY = old; }
});

test('an unrecognised or empty answer throws', withKey(async () => {
    const outside = sample();
    outside.webcams = outside.webcams.filter(w => w.webcamId === 1793900806);   // Wales only
    for (const bad of [{ error: 'nope' }, '"text"', { total: 0, webcams: [] }, outside]) {
        mockHttp([[API, bad]]);
        await assert.rejects(loadLayer('webcams').fetchWebcams(), /Webcams/);
    }
    const noTimes = sample();
    for (const w of noTimes.webcams) delete w.lastUpdatedOn;
    mockHttp([[API, noTimes]]);
    await assert.rejects(loadLayer('webcams').fetchWebcams(), /time/);
}));

test('the source credits Windy and links to its terms', () => {
    const { SOURCE } = loadLayer('webcams');
    assert.match(SOURCE.name, /Windy/);
    assert.match(SOURCE.licenceUrl, /^https:\/\/api\.windy\.com\/webcams\/terms/);
});
