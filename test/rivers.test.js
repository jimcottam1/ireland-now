// Rivers: OPW gauge levels from a saved sample of the real feed, with trends worked out from our own stored history.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const state = require('../scripts/lib/state');

const NOW = '2026-11-01T21:40:00Z';          // just after the saved feed's newest readings
const HOUR = 3600000;
const SANDY = '0000001041';                   // Sandy Mills, Co. Donegal: 0.397 m at 2026-11-01T21:30:00Z
const SANDY_TIME = '2026-11-01T21:30:00Z';
const SANDY_LEVEL = 0.397;
const ago = (hours, from = SANDY_TIME) => new Date(Date.parse(from) - hours * HOUR).toISOString().replace('.000Z', 'Z');

const feed = () => JSON.parse(fixture('rivers-latest.json').toString());
async function run(t, { raw = feed(), history = {} } = {}) {
    freezeClock(t, NOW);
    state.write('river-history', history);
    mockHttp([[/waterlevel\.ie\/geojson\/latest/, raw]]);
    return loadLayer('rivers').fetchRivers();
}
const sandy = d => d.stations.find(s => s.ref === SANDY);

test('reads the water-level sensor of each gauge, with its county', async t => {
    const d = await run(t);
    // The saved feed has 9 gauges, each with several sensors (temperature, battery...); only sensor 0001 is a level
    assert.equal(d.stations.length, 9);
    assert.deepEqual(sandy(d), {
        ref: SANDY, name: 'Sandy Mills', lat: 54.83832, lon: -7.57576, level: 0.397, time: SANDY_TIME,
        change: null, trend: 'unknown', county: 'donegal', url: 'https://waterlevel.ie/0000001041/0001/'
    });
    assert.deepEqual(d.stations.map(s => s.county).sort(), ['cork', 'cork', 'cork', 'donegal', 'donegal', 'donegal', 'dublin', 'dublin', 'dublin']);
    assert.ok(d.source.name.includes('OPW'));
});

test('sourceTime is the newest reading from any gauge', async t => {
    const d = await run(t);
    assert.equal(d.sourceTime, SANDY_TIME);
    const raw = feed();
    raw.features.find(f => f.properties.station_ref === SANDY && f.properties.sensor_ref === '0001').properties.datetime = '2026-11-01T21:45:00Z';
    assert.equal((await run(t, { raw })).sourceTime, '2026-11-01T21:45:00Z');
});

test('trend thresholds: +10 cm rising, +30 cm rising fast, -10 cm falling, else steady', async t => {
    const cases = [[0.30, 'rising-fast'], [0.299, 'rising'], [0.10, 'rising'], [0.099, 'steady'], [0, 'steady'], [-0.099, 'steady'], [-0.10, 'falling'], [-0.5, 'falling'], [0.9, 'rising-fast']];
    for (const [rise, trend] of cases) {
        const past = Number((SANDY_LEVEL - rise).toFixed(3));
        const d = await run(t, { history: { [SANDY]: [[ago(6), past]] } });
        assert.equal(sandy(d).trend, trend, `a rise of ${rise} m should be ${trend}`);
        assert.equal(sandy(d).change, Number(rise.toFixed(3)));
    }
});

test('the comparison reading is the one nearest 6 hours ago, and must be at least 4 hours old', async t => {
    let d = await run(t, { history: { [SANDY]: [[ago(7), 0.1], [ago(6.2), 0.2], [ago(5), 0.3], [ago(2), 0.39]] } });
    assert.equal(sandy(d).change, Number((0.397 - 0.2).toFixed(3)), 'the 6.2-hour-old reading');

    d = await run(t, { history: { [SANDY]: [[ago(4), 0.3]] } });
    assert.equal(sandy(d).change, 0.097, 'exactly 4 hours old is enough');

    d = await run(t, { history: { [SANDY]: [[ago(3.9), 0.3], [ago(1), 0.35]] } });
    assert.equal(sandy(d).change, null, 'recent readings only: not enough to say');
    assert.equal(sandy(d).trend, 'unknown');
});

test('a reading from long ago is not a 6-hour trend', { todo: 'BUG: with a gap in our history the only old reading is used however old it is' }, async t => {
    // We stored nothing for 30 hours (a failed run). The only older reading is 30 hours old, 0.6 m higher.
    const d = await run(t, { history: { [SANDY]: [[ago(30), 1.0]] } });
    assert.equal(sandy(d).trend, 'unknown', `got ${sandy(d).trend} (change ${sandy(d).change}) from a 30-hour-old reading`);
});

test('history: the new reading is added once, and anything over 48 hours old is dropped', async t => {
    const history = { [SANDY]: [[ago(50), 0.9], [ago(47), 0.8], [ago(6), 0.5], [SANDY_TIME, SANDY_LEVEL]] };
    await run(t, { history });
    const saved = state.read('river-history')[SANDY];
    assert.deepEqual(saved.map(r => r[0]), [ago(47), ago(6), SANDY_TIME], '50-hour-old reading gone, no duplicate of the latest');

    // A newer reading is appended after the old ones
    const raw = feed();
    raw.features.find(f => f.properties.station_ref === SANDY && f.properties.sensor_ref === '0001').properties.datetime = '2026-11-01T21:45:00Z';
    await run(t, { raw, history: { [SANDY]: [[ago(6), 0.5], [SANDY_TIME, SANDY_LEVEL]] } });
    assert.deepEqual(state.read('river-history')[SANDY].map(r => r[0]), [ago(6), SANDY_TIME, '2026-11-01T21:45:00Z']);
});

test('history for gauges that have left the feed is forgotten once it is over 48 hours old', async t => {
    const history = {
        GONE_OLD: [[ago(60), 1], [ago(49), 1]],
        GONE_RECENT: [[ago(10), 1]]
    };
    await run(t, { history });
    const saved = state.read('river-history');
    assert.ok(!('GONE_OLD' in saved));
    assert.ok('GONE_RECENT' in saved);
    // A gauge whose latest reading is itself over 48 hours old (Killavullen, last read in July) is not kept
    assert.ok(!('0000018003' in saved));
    assert.ok(SANDY in saved);
});

test('per-county files hold each gauge\'s stored readings, rounded to millimetres', async t => {
    const d = await run(t, { history: { [SANDY]: [[ago(6), 0.1234], [ago(3), 0.30000000000000004]] } });
    assert.deepEqual(Object.keys(d.files).sort(), ['rivers/cork.json', 'rivers/donegal.json', 'rivers/dublin.json']);
    assert.deepEqual(d.files['rivers/donegal.json'][SANDY], [[ago(6), 0.123], [ago(3), 0.3], [SANDY_TIME, 0.397]]);
    assert.deepEqual(Object.keys(d.files['rivers/donegal.json']).sort(), ['0000001041', '0000001043', '0000035029']);
    // Mogeely and Downing Bridge are there; Killavullen (stale since July) has no history to show
    assert.deepEqual(Object.keys(d.files['rivers/cork.json']).sort(), ['0000018001', '0000018005']);
    assert.equal(d.files['rivers/dublin.json']['0000009010'].length, 1);
});

test('county summary counts gauges and the ones rising', async t => {
    const history = {
        [SANDY]: [[ago(6), 0.05]],                      // +0.347: rising fast
        '0000001043': [[ago(6), 0.764 - 0.15]],         // +0.15: rising
        '0000035029': [[ago(6), 0.743]],                // steady
        '0000009010': [[ago(6), 0.133 + 0.2]]           // falling, in Dublin
    };
    const d = await run(t, { history });
    assert.deepEqual(d.counties.donegal, { stations: 3, rising: 2, risingFast: 1 });
    assert.deepEqual(d.counties.dublin, { stations: 3, rising: 0, risingFast: 0 });
    assert.equal(d.counties.cork.stations, 3);
    assert.equal(d.stations.find(s => s.ref === '0000009010').trend, 'falling');
});

test('a gauge outside every county, one with no position and one with no reading are handled', async t => {
    const raw = feed();
    const level = raw.features.find(f => f.properties.station_ref === SANDY && f.properties.sensor_ref === '0001');
    const copy = (ref, patch) => raw.features.push({ ...structuredClone(level), properties: { ...structuredClone(level.properties), station_ref: ref, ...patch } });
    copy('OFFSHORE', { station_name: 'Far out' });
    raw.features.at(-1).geometry.coordinates = [-14.5, 52.0];
    copy('NOPOS', {});
    raw.features.at(-1).geometry = null;
    copy('NOVALUE', { value: '' });
    copy('BATTERY', { sensor_ref: '0003' });
    const d = await run(t, { raw });
    const offshore = d.stations.find(s => s.ref === 'OFFSHORE');
    assert.equal(offshore.county, null);
    assert.ok(!d.stations.some(s => ['NOPOS', 'NOVALUE', 'BATTERY'].includes(s.ref)));
    assert.ok(Object.values(d.files).every(f => !('OFFSHORE' in f)), 'no county file for it');
    assert.equal(Object.values(d.counties).reduce((s, c) => s + c.stations, 0), 9, 'not counted in any county');
});

test('an unrecognised response throws', async t => {
    await assert.rejects(run(t, { raw: { error: 'down' } }));
    await assert.rejects(run(t, { raw: '<html>Maintenance</html>' }));
});

test('an empty feed throws rather than publishing no gauges', { todo: 'BUG: a feed with no features publishes zero stations and a null sourceTime' }, async t => {
    await assert.rejects(run(t, { raw: { type: 'FeatureCollection', features: [] } }));
});
