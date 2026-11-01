// RNLI lifeboat launches: the launches feed joined to the RNLI open station list, kept to Ireland,
// with a week of launches remembered between runs (the feed itself only holds the latest ~20).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const state = require('../scripts/lib/state');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-02T08:00:00Z');

const launch = (shortName, launchDate, id, extra = {}) => ({
    shortName, launchDate, id, cOACS: 1, title: shortName, website: `rnli.org/${shortName.replace(/\W/g, '')}`, lifeboat_IdNo: 'D-1', ...extra
});

/** Run fn with the clock fixed, so tests never depend on today's date. */
async function at(now, fn) {
    const real = Date.now;
    Date.now = () => now;
    try { return await fn(); } finally { Date.now = real; }
}

function routes(launches = JSON.parse(fixture('rnli-launches.json')), stations = fixture('rnli-stations.json'), seen = []) {
    return [
        [/FeatureServer/, url => { seen.push(url); return stations; }],
        [/api\/launches/, launches]
    ];
}

function fresh() {
    state.write('rnli-history', null);
    state.write('cache-rnli-stations', null);
}

async function run(launches, now = NOW, stations, seen) {
    mockHttp(routes(launches, stations, seen));
    return at(now, () => loadLayer('rnli').fetchRnli());
}

test('keeps only Irish stations, with a county and the right launches', async () => {
    fresh();
    const d = await run();
    assert.equal(d.stations.length, 46);
    assert.ok(!d.stations.some(s => /Teddington|Dover|Falmouth/.test(s.name)), 'English stations are dropped');
    for (const s of d.stations) {
        assert.ok(s.lat > 51 && s.lat < 55.5 && s.lon > -11 && s.lon < -5.3, `${s.name} is off the island`);
        assert.ok(s.county, `${s.name} has no county`);
        assert.ok(Array.isArray(s.launches));
    }
    const byName = Object.fromEntries(d.stations.map(s => [s.name, s]));
    assert.equal(byName.Portrush.county, 'antrim');
    assert.equal(byName.Howth.county, 'dublin');
    assert.equal(byName.Valentia.county, 'kerry');
    assert.equal(byName.Portrush.id, '1111');
    assert.deepEqual(byName.Portrush.launches, ['2026-11-01T19:07:12.000Z', '2026-11-01T09:57:27.000Z'], 'newest first');
    assert.equal(byName.Portrush.url, 'https://rnli.org/Portrush');
    assert.equal(byName.Howth.launches.length, 0);
    assert.equal(byName.Howth.url, 'https://rnli.org/find-my-nearest/lifeboat-stations/howth-lifeboat-station');
    assert.equal(d.counties.antrim.launches7d, 2);
    assert.equal(d.counties.dublin.launches7d, 0);
    assert.ok(!('devon' in d.counties));
    assert.ok(d.source.name.includes('RNLI') && /GIS Open Data/.test(d.source.licence));
});

test('sourceTime is the newest launch anywhere, even outside Ireland', async () => {
    fresh();
    const d = await run();
    assert.equal(d.sourceTime, '2026-11-01T20:47:36.000Z'); // Teddington, not Portrush
});

test('launch times are UK/Irish local time, converted to UTC', async () => {
    fresh();
    // Winter: the same as UTC
    let d = await run([launch('Portrush', '2026-12-01T19:07:12', 1)], Date.parse('2026-12-02T00:00:00Z'));
    assert.equal(d.stations.find(s => s.name === 'Portrush').launches[0], '2026-12-01T19:07:12.000Z');
    // Summer: an hour behind local time
    fresh();
    d = await run([launch('Portrush', '2026-07-01T19:07:12', 2)], Date.parse('2026-07-02T00:00:00Z'));
    assert.equal(d.stations.find(s => s.name === 'Portrush').launches[0], '2026-07-01T18:07:12.000Z');
    assert.equal(d.sourceTime, '2026-07-01T18:07:12.000Z');
});

test('names match despite accents, punctuation and county suffixes', async () => {
    fresh();
    const d = await run([
        launch('Dún Laoghaire', '2026-11-02T01:00:00', 10),
        launch('Bangor', '2026-11-02T02:00:00', 11, { title: 'Bangor, Co. Down' }),
        launch('Kilmore Quay', '2026-11-02T03:00:00', 12)
    ]);
    const by = Object.fromEntries(d.stations.map(s => [s.name, s]));
    assert.equal(by['Dun Laoghaire'].launches.length, 1);
    assert.equal(by['Bangor (Co Down)'].launches.length, 1);
    assert.equal(by['Kilmore Quay'].launches.length, 1);
    assert.equal(d.counties.down.launches7d, 1);
});

test('launches are remembered between runs, once each, for seven days', async () => {
    fresh();
    let d = await run([launch('Howth', '2026-11-01T10:00:00', 100), launch('Teddington', '2026-11-01T11:00:00', 99)], NOW);
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 1);
    assert.equal(d.recordingSince, new Date(NOW).toISOString());

    // An hour later the feed has moved on: the old Howth launch is gone from it, a new one is there
    d = await run([launch('Howth', '2026-11-02T08:30:00', 101), launch('Howth', '2026-11-02T08:30:00', 101)], NOW + HOUR);
    const howth = d.stations.find(s => s.name === 'Howth');
    assert.deepEqual(howth.launches, ['2026-11-02T08:30:00.000Z', '2026-11-01T10:00:00.000Z'], 'kept, not doubled');
    assert.equal(d.counties.dublin.launches7d, 2);
    assert.equal(d.recordingSince, new Date(NOW).toISOString(), 'recording started at the first run');

    // Six days later the first launch is still inside the week; eight days later it is not
    d = await run([launch('Howth', '2026-11-08T08:30:00', 102)], NOW + 6 * DAY);
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 3);
    d = await run([launch('Howth', '2026-11-10T08:30:00', 103)], NOW + 8 * DAY);
    assert.deepEqual(d.stations.find(s => s.name === 'Howth').launches, ['2026-11-10T08:30:00.000Z', '2026-11-08T08:30:00.000Z']);
});

test('a failed run does not change what is remembered', async () => {
    fresh();
    await run([launch('Howth', '2026-11-01T10:00:00', 100)]);
    mockHttp([[/FeatureServer/, fixture('rnli-stations.json')], [/api\/launches/, '<html>Down</html>']]);
    await assert.rejects(at(NOW + HOUR, () => loadLayer('rnli').fetchRnli()));
    const d = await run([launch('Skerries', '2026-11-02T09:00:00', 101)], NOW + 2 * HOUR);
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 1);
});

test('the station list is reused, launches are fetched every run', async () => {
    fresh();
    const seen = [];
    await run(undefined, NOW, undefined, seen);
    await run(undefined, NOW + HOUR, undefined, seen);
    assert.equal(seen.length, 1, 'station list fetched once');
});

test('an unrecognised launches feed throws', async () => {
    for (const bad of [
        '<html>Maintenance</html>',
        { error: 'nope' },
        [],
        [{ shortName: 'Howth', id: 1 }],
        [launch('Howth', 'yesterday', 1)],
        [launch('Howth', '2026-13-45T10:00:00', 1)],
        [{ ...launch('Howth', '2026-11-01T10:00:00', 1), id: 'abc' }]
    ]) {
        fresh();
        await assert.rejects(run(typeof bad === 'string' ? bad : bad), undefined, JSON.stringify(bad));
    }
});

test('an unrecognised station list throws', async () => {
    for (const bad of ['<html>Maintenance</html>', { features: [] }, { error: { code: 400 } }]) {
        fresh();
        await assert.rejects(run(undefined, NOW, bad));
    }
    // Too few Irish stations means the list is wrong, not that Ireland lost its lifeboats
    fresh();
    const some = JSON.parse(fixture('rnli-stations.json'));
    some.features = some.features.slice(0, 10);
    await assert.rejects(run(undefined, NOW, some));
});
