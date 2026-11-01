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
    shortName, launchDate, id, cOACS: [...shortName].reduce((h, c) => h * 31 + c.charCodeAt(0), 7), title: shortName, website: `rnli.org/${shortName.replace(/\W/g, '')}`, lifeboat_IdNo: 'D-1', ...extra
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
    assert.equal(byName.Portrush.url, 'https://rnli.org/find-my-nearest/lifeboat-stations/portrush-lifeboat-station', 'the checked list link wins over the feed');
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
    assert.equal(d.recordingSince, '2026-11-01T10:00:00.000Z', 'recording starts at the oldest launch we counted');

    // Later the feed has moved on but still overlaps the last run: the old launch stays, nothing doubles
    d = await run([launch('Teddington', '2026-11-01T11:00:00', 99), launch('Howth', '2026-11-02T07:30:00', 101), launch('Howth', '2026-11-02T07:30:00', 101)], NOW);
    const howth = d.stations.find(s => s.name === 'Howth');
    assert.deepEqual(howth.launches, ['2026-11-02T07:30:00.000Z', '2026-11-01T10:00:00.000Z'], 'kept, not doubled');
    assert.equal(d.counties.dublin.launches7d, 2);
    assert.equal(d.recordingSince, '2026-11-01T10:00:00.000Z', 'no gap, so the start is unchanged');

    // Six days later the first launch is still inside the week; eight days later it is not
    d = await run([launch('Howth', '2026-11-02T07:30:00', 101), launch('Howth', '2026-11-08T08:30:00', 102)], NOW + 6 * DAY);
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 3);
    d = await run([launch('Howth', '2026-11-08T08:30:00', 102), launch('Howth', '2026-11-10T08:30:00', 103)], NOW + 8 * DAY);
    assert.deepEqual(d.stations.find(s => s.name === 'Howth').launches, ['2026-11-10T08:30:00.000Z', '2026-11-08T08:30:00.000Z']);
});

test('a gap between runs moves the "counted since" start and warns', async () => {
    fresh();
    await run([launch('Howth', '2026-11-01T10:00:00', 100), launch('Howth', '2026-11-01T12:00:00', 101)], NOW);
    const warnings = [];
    const real = console.warn;
    console.warn = m => warnings.push(m);
    let d;
    try {
        // The whole feed is newer than the last launch we saw, so launches in between are lost
        d = await run([launch('Howth', '2026-11-02T01:00:00', 102), launch('Howth', '2026-11-02T05:00:00', 103)], NOW + 6 * HOUR);
    } finally { console.warn = real; }
    assert.equal(d.recordingSince, '2026-11-02T01:00:00.000Z');
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 4, 'earlier launches are still shown');
    assert.ok(warnings.some(w => /gap/i.test(w)), warnings.join('|'));
});

test('a first run counts the launches already in the feed, so "since" is not later than they are', async () => {
    fresh();
    const d = await run([launch('Howth', '2026-11-01T20:00:00', 1), launch('Howth', '2026-11-01T09:00:00', 2)], NOW);
    assert.equal(d.recordingSince, '2026-11-01T09:00:00.000Z');
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 2);
});

test('damaged history starts again instead of breaking the layer', async () => {
    for (const bad of [
        { since: 'x', lastNewest: '2026-11-01T10:00:00.000Z', launches: null },
        { since: '2026-11-01T10:00:00.000Z', lastNewest: '2026-11-01T10:00:00.000Z', launches: 'no' },
        { since: 'not a date', lastNewest: 'also not', launches: [] },
        'junk', 42, []
    ]) {
        fresh();
        state.write('rnli-history', bad);
        const d = await run([launch('Howth', '2026-11-01T10:00:00', 1)], NOW);
        assert.equal(d.recordingSince, '2026-11-01T10:00:00.000Z', JSON.stringify(bad));
        assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 1);
    }
    // Bad entries inside an otherwise good history are skipped, not fatal
    fresh();
    state.write('rnli-history', { since: '2026-11-01T00:00:00.000Z', lastNewest: '2026-11-01T10:00:00.000Z', launches: [null, { id: 'x' }, { id: 5, station: '1111', time: '2026-11-01T09:00:00.000Z' }] });
    const d = await run([launch('Howth', '2026-11-01T10:00:00', 1)], NOW);
    assert.equal(d.stations.find(s => s.name === 'Portrush').launches.length, 1);
});

test('impossible and future dates throw', async () => {
    for (const date of ['2026-06-31T10:00:00', '2026-02-30T10:00:00', '2026-04-31T00:00:00', '2026-11-02T10:30:00', '2027-11-01T10:00:00']) {
        fresh();
        await assert.rejects(run([launch('Howth', date, 1)], NOW), undefined, date);
    }
    // A few minutes ahead is clock skew, not an error
    fresh();
    const d = await run([launch('Howth', '2026-11-02T08:20:00', 1)], NOW);
    assert.equal(d.sourceTime, '2026-11-02T08:20:00.000Z');
});

test('Irish launches that match no station are counted and reported, with or without "Co."', async () => {
    fresh();
    const warnings = [];
    const logs = [];
    const [rw, rl] = [console.warn, console.log];
    console.warn = m => warnings.push(m);
    console.log = m => logs.push(m);
    let d;
    try {
        d = await run([
            launch('Clogher Head', '2026-11-01T01:00:00', 1, { title: 'Clogher Head, Co. Louth' }),
            launch('Lough Derg Rescue', '2026-11-01T02:00:00', 2, { title: 'Lough Derg Lifeboat, Tipperary' }),
            launch('Dundrum', '2026-11-01T03:00:00', 3, { title: 'Dundrum, County Down' }),
            launch('Howth', '2026-11-01T04:00:00', 4),
            launch('Wandsworth', '2026-11-01T05:00:00', 5, { title: 'Wandsworth, London' })
        ]);
    } finally { console.warn = rw; console.log = rl; }
    assert.equal(d.unmatchedIrish.count, 3, JSON.stringify(d.unmatchedIrish));
    assert.deepEqual(d.unmatchedIrish.names, ['Clogher Head, Co. Louth', 'Dundrum, County Down', 'Lough Derg Lifeboat, Tipperary']);
    assert.equal(warnings.filter(w => /no station matched/.test(w)).length, 3);
    assert.ok(logs.some(l => /RNLI: 3 unmatched Irish launches/.test(l)), logs.join('|'));

    fresh();
    d = await run();
    assert.equal(d.unmatchedIrish.count, 0);
});

test('once a feed code has matched a station, later spellings join on the code', async () => {
    fresh();
    await run([launch('Howth', '2026-11-01T10:00:00', 1, { cOACS: 777 })], NOW);
    const d = await run([launch('Howth', '2026-11-01T10:00:00', 1, { cOACS: 777 }), launch('Howth Harbour Lifeboat', '2026-11-01T12:00:00', 2, { cOACS: 777, title: 'Somewhere else' })], NOW);
    assert.equal(d.stations.find(s => s.name === 'Howth').launches.length, 2);
    assert.equal(d.unmatchedIrish.count, 0);
});

test('an expired station list is used when the refresh fails, if it is still sound', async () => {
    fresh();
    const good = await run();
    const old = { updatedAt: new Date(NOW - 40 * DAY).toISOString(), stations: good.stations.map(({ launches, ...s }) => s) };
    state.write('cache-rnli-stations', old);
    const warnings = [];
    const real = console.warn;
    console.warn = m => warnings.push(m);
    try {
        mockHttp([[/FeatureServer/, () => { throw new Error('HTTP 503'); }], [/api\/launches/, [launch('Howth', '2026-11-02T07:00:00', 50)]]]);
        const d = await at(NOW, () => loadLayer('rnli').fetchRnli());
        assert.equal(d.stations.length, 46);
        assert.ok(d.stations.find(s => s.name === 'Howth').launches.includes('2026-11-02T07:00:00.000Z'), 'the launch is still recorded');
        assert.ok(warnings.some(w => /station list/i.test(w)));
        // An unsound old list is no help: the layer fails as before
        state.write('cache-rnli-stations', { ...old, stations: old.stations.slice(0, 5) });
        await assert.rejects(at(NOW, () => loadLayer('rnli').fetchRnli()));
        state.write('cache-rnli-stations', null);
        await assert.rejects(at(NOW, () => loadLayer('rnli').fetchRnli()));
    } finally { console.warn = real; }
});

test('the feed website is used only when the station list has no link', async () => {
    fresh();
    const stations = JSON.parse(fixture('rnli-stations.json'));
    stations.features.find(f => f.attributes.Station === 'Howth').attributes.URL = 'http://evil.example/howth';
    const d = await run([launch('Howth', '2026-11-01T10:00:00', 1, { website: 'rnli.org/Howth' }), launch('Skerries', '2026-11-01T11:00:00', 2, { website: 'javascript:alert(1)' })], NOW, stations);
    assert.equal(d.stations.find(s => s.name === 'Howth').url, 'https://rnli.org/Howth');
    assert.equal(d.stations.find(s => s.name === 'Skerries').url, 'https://rnli.org/find-my-nearest/lifeboat-stations/skerries-lifeboat-station');
});

test('the credit links to the licence', () => {
    const { SOURCE } = loadLayer('rnli');
    assert.match(SOURCE.licence, /Contains Open Data licensed under the GIS Open Data Licence/);
    assert.match(SOURCE.licenceUrl, /^https:\/\//);
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
