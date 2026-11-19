// EPA radon map: the real answer (saved 19 November 2026, 868 squares in Irish Grid metres), with each coastal
// outline cut down to its corner points to keep the file small. Four squares are repeated word for word in
// the real map and one has no estimate (-999); both are kept as they are.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');
const { irishGridToLatLon, itmToLatLon } = require('../scripts/lib/itm');

const raw = JSON.parse(fixture('epa-radon.json'));

async function run(body = raw) {
    mockHttp([[/RAD_RadonMap/, body]]);
    return loadLayer('radon').fetchRadon();
}

test('Irish Grid and ITM convert to latitude and longitude', () => {
    // The EPA's own reprojection of the square at 270000, 150000 (Irish Grid) is 52.59717, -6.96770;
    // without a datum shift we land within about 100 m of it
    const [lat, lon] = irishGridToLatLon(270000, 150000);
    const metres = Math.hypot((lon + 6.96770) * Math.cos(lat * Math.PI / 180), lat - 52.59717) * 111320;
    assert.ok(metres < 100, `${metres.toFixed(0)} m out`);
    // Each grid's false origin is 53.5°N 8°W
    assert.deepEqual(itmToLatLon(600000, 750000).map(v => Number(v.toFixed(6))), [53.5, -8]);
    assert.deepEqual(irishGridToLatLon(200000, 250000).map(v => Number(v.toFixed(6))), [53.5, -8]);
});

test('every square becomes a 10 km box in a county, repeats counted once', async () => {
    const d = await run();
    assert.equal(d.squares.length, 863);   // 868 less four repeats and one without an estimate
    // The map runs a few squares over the border into Fermanagh and Tyrone; those are drawn but not counted
    const outside = d.squares.filter(s => s.county === null);
    assert.ok(outside.length <= 8, `${outside.length} squares outside the Republic`);
    for (const s of d.squares) {
        if (s.county !== null) assert.ok(ROI_IDS.includes(s.county), `square at ${s.bounds} has county ${s.county}`);
        const [south, west, north, east] = s.bounds;
        assert.ok(north - south > 0.08 && north - south < 0.1, 'about 10 km tall');
        assert.ok(east - west > 0.13 && east - west < 0.17, 'about 10 km wide');
    }
    const counted = Object.values(d.counties).reduce((n, c) => n + c.squares, 0);
    assert.equal(counted, d.squares.length - outside.length);
});

test('High Radon Areas (10% or more) are counted per county', async () => {
    const d = await run();
    assert.equal(d.high, 10);
    const high = d.squares.filter(s => s.county && s.high).length;
    assert.ok(d.squares.every(s => s.high === (s.percent >= 10) || Math.abs(s.percent - 10) < 0.06), 'the flag matches the figure, bar rounding');
    assert.equal(Object.values(d.counties).reduce((n, c) => n + c.high, 0), high);
    // The EPA's best-known high radon counties come out on top
    assert.ok(d.counties.carlow.highShare >= 50 && d.counties.sligo.highShare >= 50);
    assert.ok(d.counties.dublin.highShare < d.counties.carlow.highShare);
});

test('a repeat that disagrees, a bad percentage or a short map fails', async () => {
    const twin = structuredClone(raw.features.find(f => f.properties.PERCENT_ > 0));
    twin.properties.PERCENT_ += 5;
    await assert.rejects(run({ ...raw, features: [...raw.features, twin] }), /two different values/);
    const bad = structuredClone(raw);
    bad.features[10].properties.PERCENT_ = 140;
    await assert.rejects(run(bad), /not a percentage/);
    await assert.rejects(run({ ...raw, features: raw.features.slice(0, 300) }), /only \d+ squares/);
    await assert.rejects(run({ error: 'down' }), /not recognised/);
});
