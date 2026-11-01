// Dublin Bikes: stations and totals, read from a hand-made sample of the documented JCDecaux response.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

// The real http functions, copied before mockHttp replaces them
const realHttp = { ...require('../scripts/lib/http') };

const KEY = 'test-key-123';
const withKey = fn => async t => {
    const old = process.env.JCDECAUX_API_KEY;
    process.env.JCDECAUX_API_KEY = KEY;
    try { await fn(t); } finally { if (old === undefined) delete process.env.JCDECAUX_API_KEY; else process.env.JCDECAUX_API_KEY = old; }
};
const route = body => [[/api\.jcdecaux\.com\/vls\/v1\/stations/, body]];

test('stations and totals', withKey(async () => {
    let url;
    mockHttp(route(u => { url = u; return fixture('jcdecaux-dublin.json'); }));
    const d = await loadLayer('bikes').fetchBikes();
    assert.match(url, /contract=dublin/);
    assert.match(url, new RegExp(`apiKey=${KEY}`));
    assert.equal(d.stations.length, 4, 'the station without a position is ignored');
    const s = d.stations.find(x => x.id === 42);
    assert.deepEqual(s, { id: 42, name: 'SMITHFIELD NORTH', lat: 53.349562, lon: -6.278198, bikes: 22, stands: 8, capacity: 30, open: true });
    assert.equal(d.stations.find(x => x.id === 9).open, false);
    // Closed stations are left out of the bike and stand totals
    assert.deepEqual(d.totals, { bikes: 25, stands: 65, stations: 4, open: 3 });
    assert.ok(d.source.name.includes('JCDecaux'));
    assert.ok(d.source.licence);
}));

test('sourceTime is the newest last_update, in UTC', withKey(async () => {
    mockHttp(route(fixture('jcdecaux-dublin.json')));
    const d = await loadLayer('bikes').fetchBikes();
    assert.equal(d.sourceTime, new Date(1793581300000).toISOString());
}));

test('a missing key throws before any request', async () => {
    const old = process.env.JCDECAUX_API_KEY;
    delete process.env.JCDECAUX_API_KEY;
    try {
        mockHttp([]);
        await assert.rejects(loadLayer('bikes').fetchBikes(), /JCDECAUX_API_KEY is not set/);
    } finally { if (old !== undefined) process.env.JCDECAUX_API_KEY = old; }
});

test('an unrecognised or empty response throws', withKey(async () => {
    for (const bad of [{ error: 'nope' }, '"text"', [], [{ number: 1, position: null, last_update: 1 }]]) {
        mockHttp(route(bad));
        await assert.rejects(loadLayer('bikes').fetchBikes(), /Dublin Bikes/);
    }
    const noTime = JSON.parse(fixture('jcdecaux-dublin.json')).map(s => ({ ...s, last_update: null }));
    mockHttp(route(noTime));
    await assert.rejects(loadLayer('bikes').fetchBikes(), /time/);
}));

test('a failed request never puts the key in the error', withKey(async () => {
    // Use the real http module with a fake fetch, so its own error message is what we check
    const http = realHttp;
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 403 });
    try {
        const url = `https://api.jcdecaux.com/vls/v1/stations?contract=dublin&apiKey=${KEY}`;
        await assert.rejects(http.getJson(url, { retries: 0 }), e => {
            assert.ok(!/apiKey=/.test(e.message) && !e.message.includes(KEY), e.message);
            return /api\.jcdecaux\.com/.test(e.message);
        });
    } finally { global.fetch = realFetch; }
}));
