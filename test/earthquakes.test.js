// Earthquakes: EMSC events in and around Ireland, from a saved real response.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const feed = () => JSON.parse(fixture('emsc-quakes.json').toString());
async function run(t, body = feed(), seen = []) {
    freezeClock(t, '2026-11-01T21:50:00Z');
    mockHttp([[/seismicportal\.eu\/fdsnws/, url => { seen.push(url); return body; }]]);
    return loadLayer('earthquakes').fetchEarthquakes();
}

test('asks for the last year inside the Ireland box', async t => {
    const seen = [];
    await run(t, feed(), seen);
    const q = new URL(seen[0]).searchParams;
    assert.equal(q.get('starttime'), '2025-11-01');
    assert.equal(q.get('format'), 'json');
    assert.equal(q.get('limit'), '200');
    assert.deepEqual([q.get('minlat'), q.get('maxlat'), q.get('minlon'), q.get('maxlon')], ['51.2', '55.6', '-11', '-5.3']);
});

test('parses events: magnitude, depth, region, agency, rounded position and a link', async t => {
    const d = await run(t);
    assert.equal(d.quakes.length, 17);
    const q = d.quakes.find(x => x.id === '20260131_0000409');
    assert.deepEqual(q, {
        id: '20260131_0000409', time: '2026-01-31T19:24:34.2Z', lat: 52.67, lon: -6.45, depthKm: 2, magnitude: 1.3,
        region: 'IRELAND', agency: 'INSN', county: 'wexford',
        url: 'https://www.seismicportal.eu/eventdetails.html?unid=20260131_0000409'
    });
    assert.ok(d.source.name.includes('EMSC'));
});

test('newest first, whatever order the source sent them in', async t => {
    const body = feed();
    body.features.reverse();
    const d = await run(t, body);
    const times = d.quakes.map(q => q.time);
    assert.deepEqual(times, [...times].sort().reverse());
    assert.equal(d.quakes[0].id, '20260928_0000330');
    assert.equal(d.quakes.at(-1).id, '20251101_0000491');
});

test('county comes from the position: land events get a county, open water does not', async t => {
    const d = await run(t);
    const county = id => d.quakes.find(q => q.id === id).county;
    assert.equal(county('20260921_0000443'), 'donegal');
    assert.equal(county('20260823_0000398'), 'leitrim');
    assert.equal(county('20260811_0000112'), 'waterford');
    assert.equal(county('20260203_0000215'), null, 'middle of the Irish Sea');
    assert.equal(county('20251101_0000491'), null);
});

test('an event in Scotland is not given an Irish county', async t => {
    const d = await run(t);
    const scottish = d.quakes.filter(q => /SCOTLAND/.test(q.region));
    assert.ok(scottish.length >= 3);
    for (const q of scottish) assert.equal(q.county, null, `${q.id} at ${q.lat}, ${q.lon} (${q.region}) was given ${q.county}`);
});

test('regions that name another country get no county, even on the coast; Irish ones keep theirs', async t => {
    const body = feed();
    const make = (region, lat, lon, unid) => ({ ...structuredClone(body.features[1]), properties: { ...body.features[1].properties, flynn_region: region, lat, lon, unid } });
    // 55.13, -7.74 is inside Donegal: only the region differs
    body.features = ['WALES', 'ENGLAND', 'ISLE OF MAN', 'SCOTLAND, UNITED KINGDOM'].map((r, i) => make(r, 55.13, -7.74, `x${i}`))
        .concat([make('IRELAND', 55.13, -7.74, 'ie'), make('NORTHERN IRELAND, U.K. REGION', 55.13, -7.74, 'ni'), make('IRISH SEA', 53.0, -6.0, 'sea')]);
    const d = await run(t, body);
    const county = id => d.quakes.find(q => q.id === id).county;
    for (const id of ['x0', 'x1', 'x2', 'x3']) assert.equal(county(id), null, id);
    assert.equal(county('ie'), 'donegal');
    assert.equal(county('ni'), 'donegal');
    assert.equal(county('sea'), 'wicklow', 'just offshore still maps to the nearest county');
});

test('depth is shown as a positive distance, and a missing depth stays null', async t => {
    const body = feed();
    body.features[0].properties.depth = -8;
    body.features[1].properties.depth = null;
    const d = await run(t, body);
    assert.equal(d.quakes.find(q => q.id === body.features[0].properties.unid).depthKm, 8);
    assert.equal(d.quakes.find(q => q.id === body.features[1].properties.unid).depthKm, null);
});

test('a quiet year gives an empty list, and a broken response throws', async t => {
    const d = await run(t, { type: 'FeatureCollection', features: [] });
    assert.deepEqual(d.quakes, []);
    await assert.rejects(run(t, '<html>Service Unavailable</html>'));
});
