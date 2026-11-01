// Tides: Marine Institute tide gauges, from a saved real answer plus small made-up series for the edge cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const NOW = '2026-11-01T21:30:00Z';
const feed = () => JSON.parse(fixture('erddap-tides.json').toString());
async function run(t, body = feed(), seen = []) {
    freezeClock(t, NOW);
    mockHttp([[/erddap\.marine\.ie/, url => { seen.push(url); return body; }]]);
    return loadLayer('tides').fetchTides();
}
const table = rows => ({ table: { columnNames: [], columnTypes: [], columnUnits: [], rows } });
// A row is [station, lat, lon, time, level]. A made-up series for Dublin Port, one reading every 5 minutes from 20:45 to 21:25.
const at = minutes => new Date(Date.parse('2026-11-01T20:45:00Z') + minutes * 60000).toISOString().replace('.000Z', 'Z');
const series = (levelAt, name = 'Dublin Port', from = 0, to = 40) => {
    const rows = [];
    for (let m = from; m <= to; m += 5) rows.push([name, 53.3457, -6.2217, at(m), levelAt(m)]);
    return rows;
};
const gauge = (d, name = 'Dublin Port') => d.gauges.find(g => g.name === name);

test('asks for the last two hours of the tide gauge network', async t => {
    const seen = [];
    await run(t, feed(), seen);
    assert.match(seen[0], /IrishNationalTideGaugeNetwork\.json\?station_id,latitude,longitude,time,Water_Level_LAT/);
    assert.match(seen[0], /&time%3E=2026-11-01T19:30:00Z$/);
});

test('real answer: one gauge per station, with its newest level and county', async t => {
    const raw = feed();
    const d = await run(t, raw);
    assert.equal(d.gauges.length, 8);
    const dublin = gauge(d);
    const last = raw.table.rows.filter(r => r[0] === 'Dublin Port').sort((a, b) => a[3].localeCompare(b[3])).at(-1);
    assert.deepEqual([dublin.time, dublin.level, dublin.lat, dublin.lon, dublin.county], [last[3], Number(last[4].toFixed(2)), 53.3457, -6.2217, 'dublin']);
    assert.equal(gauge(d, 'Galway Port').county, 'galway');
    assert.equal(gauge(d, 'Killybegs Port').county, 'donegal');
    assert.equal(gauge(d, 'Castletownbere Port').county, 'cork');
    assert.ok(d.gauges.every(g => ['rising', 'falling', 'turning'].includes(g.direction)));
    assert.ok(d.source.name.includes('Marine Institute'));
});

test('the real direction matches the change over about half an hour', async t => {
    const raw = feed();
    const d = await run(t, raw);
    for (const g of d.gauges) {
        const readings = raw.table.rows.filter(r => r[0] === g.name).sort((a, b) => a[3].localeCompare(b[3]));
        const latest = readings.at(-1);
        const earlier = readings.filter(r => Date.parse(latest[3]) - Date.parse(r[3]) >= 25 * 60000).at(-1);
        const change = latest[4] - earlier[4];
        assert.equal(g.direction, change > 0.02 ? 'rising' : change < -0.02 ? 'falling' : 'turning', `${g.name} changed ${change}`);
    }
});

test('rising, falling and turning follow a 2 cm threshold', async t => {
    // Latest reading 40 minutes in; the comparison reading is the newest one at least 25 minutes earlier (minute 15)
    const dir = async (latestLevel, name = 'Dublin Port') => gauge(await run(t, table(series(m => m === 40 ? latestLevel : 2.0)), undefined), name).direction;
    assert.equal(await dir(2.05), 'rising');
    assert.equal(await dir(2.03), 'rising');
    assert.equal(await dir(2.01), 'turning');
    assert.equal(await dir(2.0), 'turning');
    assert.equal(await dir(1.99), 'turning');
    assert.equal(await dir(1.97), 'falling');
    assert.equal(await dir(0.5), 'falling');
});

test('the comparison reading is at least 25 minutes old; without one the direction is unknown', async t => {
    // Only the last 20 minutes: nothing is old enough to compare with
    let d = await run(t, table(series(m => 1 + m / 100, 'Dublin Port', 20, 40)));
    assert.equal(gauge(d).direction, 'unknown');
    // Exactly 25 minutes of history is enough
    d = await run(t, table(series(m => 1 + m / 100, 'Dublin Port', 15, 40)));
    assert.equal(gauge(d).direction, 'rising');
    // A single reading
    d = await run(t, table(series(() => 1, 'Dublin Port', 40, 40)));
    assert.equal(gauge(d).direction, 'unknown');
});

test('readings in any order: the newest is the level, sorting is by time', async t => {
    const rows = series(m => 1 + m / 100).reverse();
    const d = await run(t, table(rows));
    assert.equal(gauge(d).time, at(40));
    assert.equal(gauge(d).level, 1.4);
    assert.equal(gauge(d).direction, 'rising');
});

test('levels are shown to the centimetre and positions to four decimal places', async t => {
    const d = await run(t, table([['Dublin Port', 53.34567891, -6.22171234, at(0), 2.0149]]));
    assert.deepEqual([gauge(d).level, gauge(d).lat, gauge(d).lon], [2.01, 53.3457, -6.2217]);
});

test('readings without a level or position are ignored', async t => {
    const rows = [...series(m => 1, 'Dublin Port', 0, 35), ['Dublin Port', 53.3457, -6.2217, at(40), null], ['Broken Gauge', null, -6, at(40), 1], ['Dead Gauge', 53, -6, at(40), null]];
    const d = await run(t, table(rows));
    assert.equal(gauge(d).time, at(35), 'the empty newest reading is skipped');
    assert.deepEqual(d.gauges.map(g => g.name), ['Dublin Port']);
});

test('a gauge at sea with no county nearby has county null', async t => {
    const d = await run(t, table([['Far Buoy', 52.0, -14.5, at(0), 1]]));
    assert.equal(gauge(d, 'Far Buoy').county, null);
});

test('an unrecognised response throws', async t => {
    await assert.rejects(run(t, '<html>Not found</html>'));
    await assert.rejects(run(t, { message: 'Query error' }));
});

test('no readings at all throws rather than publishing no gauges', async t => {
    await assert.rejects(run(t, table([])));
});
