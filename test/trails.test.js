// Sport Ireland National Trails Register: both pages of the real answer (saved 19 November 2026, 1,348 trails),
// each line cut to its first point, which is all the layer uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { COUNTY_IDS, NI_IDS } = require('../scripts/lib/geo');

const pages = [JSON.parse(fixture('trails-page-1.json')), JSON.parse(fixture('trails-page-2.json'))];

async function run(answers = pages) {
    const asked = [];
    mockHttp([[/NTR_ITM_view\/FeatureServer\/0\/query/, url => {
        asked.push(url);
        const offset = Number(new URL(url).searchParams.get('resultOffset'));
        return answers[offset / 1000] || { features: [] };
    }]]);
    const d = await loadLayer('trails').fetchTrails();
    return { d, asked };
}

test('reads every page and places each trail start in a county, all-island', async () => {
    const { d, asked } = await run();
    assert.equal(asked.length, 2, 'stops after the page without exceededTransferLimit');
    assert.ok(d.trails.length > 1300, `${d.trails.length} trails`);
    assert.equal(d.allIsland, true);
    for (const t of d.trails) assert.ok(COUNTY_IDS.includes(t.county), `${t.name} has county ${t.county}`);
    assert.ok(d.trails.some(t => NI_IDS.includes(t.county)), 'Northern Ireland trails are kept');
    const counted = Object.values(d.counties).reduce((s, c) => s + c.total, 0);
    assert.equal(counted, d.trails.length);
});

test('lengths come from the line itself, in kilometres', async () => {
    const { d } = await run();
    const barrow = d.trails.find(t => t.name === 'Barrow Way');
    assert.equal(barrow.type, 'Long-distance way');
    assert.equal(barrow.group, 'walk');
    assert.ok(barrow.km > 100 && barrow.km < 130, `${barrow.km} km`);
    // The register's own length field is wrong for some trails (EuroVelo 1 says 2,365); the line says the same here
    assert.ok(d.trails.every(t => t.km == null || t.km < 3000));
});

test('a short register or an error answer fails, so the last good copy is kept', async () => {
    await assert.rejects(run([{ features: pages[0].features.slice(0, 200) }]), /only \d+ trails/);
    await assert.rejects(run([{ error: { code: 400, message: 'Invalid query' } }]), /Invalid query/);
    await assert.rejects(run([{ nothing: true }]), /not recognised/);
});

test('routes go in their own file, one per trail in the same order, starting at the dot', async () => {
    const { d } = await run();
    const lines = d.files['trail-lines.json'];
    assert.equal(lines.length, d.trails.length);
    d.trails.forEach((t, i) => {
        const [lat, lon] = lines[i][0][0];
        assert.ok(Math.abs(lat - t.lat) < 0.001 && Math.abs(lon - t.lon) < 0.001, `${t.name}'s route starts at its dot`);
    });
    assert.ok(!('line' in d.trails[0]), 'the main file has no routes');
});

test('a route with several pieces keeps each piece, in latitude-longitude order', async () => {
    const one = structuredClone(pages);
    const f = one[0].features.find(x => x.attributes.Trail_Name === 'Barrow Way');
    f.geometry.paths = [[[-6.9268, 52.4871], [-6.93, 52.49]], [[-6.95, 52.5], [-6.96, 52.51], [-6.97, 52.52]]];
    const { d } = await run(one);
    const i = d.trails.findIndex(t => t.name === 'Barrow Way');
    assert.deepEqual(d.files['trail-lines.json'][i], [[[52.4871, -6.9268], [52.49, -6.93]], [[52.5, -6.95], [52.51, -6.96], [52.52, -6.97]]]);
});

test('a page that never ends fails rather than looping', async () => {
    await assert.rejects(run(Array(10).fill(pages[0])), /still more after/);
});
