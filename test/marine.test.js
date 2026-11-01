// Marine: Irish weather buoys (Marine Institute ERDDAP), from a saved real answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const NOW = '2026-11-01T21:50:00Z';
const feed = () => JSON.parse(fixture('erddap-buoys.json').toString());
async function run(t, body = feed(), seen = []) {
    freezeClock(t, NOW);
    mockHttp([[/erddap\.marine\.ie/, url => { seen.push(url); return body; }]]);
    return loadLayer('marine').fetchMarine();
}
// Column order of a row: id, time, lon, lat, pressure, windDir, wind, gust, wave, period, sea, air
const row = (id, time, over = {}) => {
    const r = { id, time, lon: -5.43, lat: 53.48, pressure: 1010.4, windDir: 200, wind: 10, gust: 15, wave: 2.04, period: 6.25, sea: 12.34, air: 10.06, ...over };
    return [r.id, r.time, r.lon, r.lat, r.pressure, r.windDir, r.wind, r.gust, r.wave, r.period, r.sea, r.air];
};
const table = rows => ({ table: { columnNames: [], columnTypes: [], columnUnits: [], rows } });

test('asks for the last six hours of the buoy network', async t => {
    const seen = [];
    await run(t, feed(), seen);
    assert.match(seen[0], /IWBNetwork\.json\?station_id,time,longitude,latitude,AtmosphericPressure,WindDirection,WindSpeed,Gust,WaveHeight,WavePeriod,SeaTemperature,AirTemperature/);
    assert.match(seen[0], /&time%3E=2026-11-01T15:50:00Z$/);
});

test('real answer: the newest reading of each buoy, in order, with wind in km/h', async t => {
    const d = await run(t);
    assert.deepEqual(d.buoys.map(b => b.id), ['M2', 'M3', 'M5', 'M6']);
    assert.deepEqual(d.buoys[0], {
        id: 'M2', name: 'M2 buoy', place: 'Irish Sea, east of Howth', lat: 53.4836, lon: -5.4302, time: '2026-11-01T21:00:00Z',
        windKmh: 35, gustKmh: 43, windDirection: 27, waveHeight: 1.5, wavePeriod: 4.1, seaTemperature: 14.1, airTemperature: 12.4, pressure: 1039
    });
    assert.equal(d.buoys[3].place, 'Atlantic, west of the Porcupine Bank');
    assert.ok(d.buoys.every(b => b.time === '2026-11-01T21:00:00Z'));
    assert.ok(d.source.name.includes('Marine Institute'));
});

test('knots become km/h (1 knot = 1.852 km/h), rounded to whole numbers', async t => {
    const d = await run(t, table([row('M2', '2026-11-01T21:00:00Z', { wind: 10, gust: 20.4 }), row('M3', '2026-11-01T21:00:00Z', { wind: 0, gust: 0 })]));
    assert.equal(d.buoys[0].windKmh, 19);      // 18.52
    assert.equal(d.buoys[0].gustKmh, 38);      // 37.78
    assert.equal(d.buoys[1].windKmh, 0, 'calm is zero, not missing');
    assert.equal(d.buoys[1].gustKmh, 0);
    // The wind speed is not mistaken for km/h
    assert.notEqual(d.buoys[0].windKmh, 10);
});

test('the newest row wins whatever order they arrive in', async t => {
    const rows = [row('M2', '2026-11-01T19:00:00Z', { wind: 5 }), row('M2', '2026-11-01T21:00:00Z', { wind: 20 }), row('M2', '2026-11-01T20:00:00Z', { wind: 12 })];
    const d = await run(t, table(rows));
    assert.equal(d.buoys[0].time, '2026-11-01T21:00:00Z');
    assert.equal(d.buoys[0].windKmh, Math.round(20 * 1.852));
});

test('a row without a position is skipped in favour of an older reading', async t => {
    const d = await run(t, table([row('M2', '2026-11-01T20:00:00Z', { wind: 12 }), row('M2', '2026-11-01T21:00:00Z', { lat: null, lon: null, wind: null })]));
    assert.equal(d.buoys[0].time, '2026-11-01T20:00:00Z');
    assert.equal(d.buoys[0].windKmh, Math.round(12 * 1.852));
});

test('a missing measurement is null, not zero', async t => {
    const d = await run(t, table([row('M2', '2026-11-01T21:00:00Z', { wind: null, gust: null, wave: null, period: null, sea: null, air: null, pressure: null, windDir: null })]));
    const b = d.buoys[0];
    assert.deepEqual([b.windKmh, b.gustKmh, b.waveHeight, b.wavePeriod, b.seaTemperature, b.airTemperature, b.pressure, b.windDirection], Array(8).fill(null));
});

test('an unknown buoy still appears, with a general place', async t => {
    const d = await run(t, table([row('M9', '2026-11-01T21:00:00Z'), row('M2', '2026-11-01T21:00:00Z')]));
    assert.deepEqual(d.buoys.map(b => [b.id, b.place]), [['M2', 'Irish Sea, east of Howth'], ['M9', 'Irish waters']]);
});

test('no readings in the last six hours throws, and so does an unrecognised response', async t => {
    await assert.rejects(run(t, table([])), /No buoy readings/);
    await assert.rejects(run(t, table([row('M2', '2026-11-01T21:00:00Z', { lat: null })])), /No buoy readings/);
    await assert.rejects(run(t, '<html>Not found</html>'));
    await assert.rejects(run(t, { message: 'Query error' }));
});
