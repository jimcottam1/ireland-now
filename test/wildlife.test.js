// GBIF wildlife sightings: four real pages for Ireland, 20 October to 19 November 2026 (saved 19 November),
// with every other record and only the fields the layer reads, to keep the file small.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const { COUNTY_IDS } = require('../scripts/lib/geo');

const pages = JSON.parse(fixture('gbif-ireland-30-days.json'));

async function run(t, answers = pages) {
    freezeClock(t, '2026-11-19T22:00:00Z');
    const asked = [];
    mockHttp([[/api\.gbif\.org\/v1\/occurrence\/search/, url => {
        asked.push(url);
        const offset = Number(new URL(url).searchParams.get('offset'));
        return answers[offset / 300] || { endOfRecords: true, results: [] };
    }]]);
    const d = await loadLayer('wildlife').fetchWildlife();
    return { d, asked };
}

test('asks for the last 30 days in Ireland and reads every page', async t => {
    const { d, asked } = await run(t);
    assert.equal(asked.length, 4, 'stops at endOfRecords');
    assert.match(asked[0], /country=IE&eventDate=2026-10-20,2026-11-19/);
    const points = d.files['wildlife-points.json'];
    assert.ok(points.length > 300, `${points.length} sightings`);
    for (const [group, , name, day, county, lat, lon] of points) {
        assert.ok(COUNTY_IDS.includes(county), `${name} has county ${county}`);
        assert.match(day, /^2026-1[01]-\d{2}$/);
        assert.equal(lat, Number(lat.toFixed(2)), 'positions are rounded to about 1 km');
        assert.equal(lon, Number(lon.toFixed(2)));
        assert.ok(['birds', 'mammals', 'insects', 'plants', 'fungi', 'sea life', 'other'].includes(group));
    }
    assert.equal(d.allIsland, true);
});

test('only open licences are used, and repeats of a species at one place and day are merged', async t => {
    const extra = structuredClone(pages);
    const first = extra[0].results[0];
    extra[0].results.push({ ...first }, { ...first, species: 'Testus restrictus', license: 'All rights reserved' });
    const { d } = await run(t, extra);
    const { d: plain } = await run(t);
    const points = d.files['wildlife-points.json'];
    assert.equal(points.length, plain.files['wildlife-points.json'].length, 'the copy and the closed-licence record add nothing');
    assert.ok(!points.some(p => p[2] === 'Testus restrictus'));
});

test('counties count sightings, species and the most seen', async t => {
    const { d } = await run(t);
    const total = Object.values(d.counties).reduce((n, c) => n + c.sightings, 0);
    assert.equal(total, d.files['wildlife-points.json'].length);
    for (const c of Object.values(d.counties)) {
        assert.ok(c.speciesCount <= c.sightings);
        assert.ok(c.top.length <= 5 && c.top.every(([, n]) => n >= 1));
    }
    assert.ok(d.datasets.length && d.datasets[0][1] > 0, 'datasets are credited');
    assert.match(d.newest, /^2026-11-\d{2}$/);
});

test('an empty or unrecognised answer fails, so the last good copy is kept', async t => {
    await assert.rejects(run(t, [{ endOfRecords: true, results: pages[0].results.slice(0, 20) }]), /only \d+ usable sightings/);
    await assert.rejects(run(t, [{ error: 'busy' }]), /not recognised/);
});
