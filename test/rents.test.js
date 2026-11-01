// Rents: RTB average rents by county (CSO table RIQ02), from a trimmed copy of the real table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');
const cso = require('./cso-helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const run = async (raw = cso.table('RIQ02')) => {
    mockHttp([[/ReadDataset\/RIQ02\//, raw]]);
    return loadLayer('rents').fetchRents();
};
const ALL = { C02970: 'All bedrooms', C02969: 'All property types' };

test('the latest quarter, all bedrooms and property types, with the change on a year earlier', async () => {
    const raw = cso.table('RIQ02');
    const d = await run(raw);
    assert.equal(d.quarter, '2025Q4');
    assert.equal(d.published, raw.updated);
    const now = cso.get(raw, { ...ALL, C03004: 'Dublin', TLIST: '2025Q4' });
    const before = cso.get(raw, { ...ALL, C03004: 'Dublin', TLIST: '2024Q4' });
    assert.equal(d.counties.dublin.rent, Math.round(now));
    assert.equal(d.counties.dublin.change, Number((100 * (now - before) / before).toFixed(1)));
    // Not a one-bed flat or an apartment: those have other figures in the table
    assert.notEqual(d.counties.dublin.rent, Math.round(cso.get(raw, { C02970: 'One bed', C02969: 'All property types', C03004: 'Dublin', TLIST: '2025Q4' })));
    assert.notEqual(d.counties.dublin.rent, Math.round(cso.get(raw, { C02970: 'All bedrooms', C02969: 'Apartment', C03004: 'Dublin', TLIST: '2025Q4' })));
});

test('a county gets the county figure, not a city or postcode inside it', async () => {
    const raw = cso.table('RIQ02');
    const d = await run(raw);
    assert.equal(d.counties.cork.rent, Math.round(cso.get(raw, { ...ALL, C03004: 'Cork', TLIST: '2025Q4' })));
    assert.notEqual(d.counties.cork.rent, Math.round(cso.get(raw, { ...ALL, C03004: 'Cork City', TLIST: '2025Q4' })));
    assert.equal(d.counties.galway.rent, Math.round(cso.get(raw, { ...ALL, C03004: 'Galway', TLIST: '2025Q4' })));
    assert.notEqual(d.counties.dublin.rent, Math.round(cso.get(raw, { ...ALL, C03004: 'Dublin 2', TLIST: '2025Q4' })));
});

test('history is the last eight quarters, oldest first', async () => {
    const raw = cso.table('RIQ02');
    const h = (await run(raw)).counties.kerry.history;
    assert.deepEqual(h.map(([q]) => q), ['2024Q1', '2024Q2', '2024Q3', '2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4']);
    assert.equal(h[7][1], Math.round(cso.get(raw, { ...ALL, C03004: 'Kerry', TLIST: '2025Q4' })));
    assert.equal(h[0][1], Math.round(cso.get(raw, { ...ALL, C03004: 'Kerry', TLIST: '2024Q1' })));
});

test('a quarter with figures for fewer than 20 counties is not the latest yet', async () => {
    const raw = cso.table('RIQ02');
    const keep = ['Dublin', 'Cork', 'Galway', 'Kerry', 'Mayo'];
    for (const name of cso.labels(raw, 'C03004').filter(n => !keep.includes(n))) cso.set(raw, { C03004: name, TLIST: '2025Q4' }, null);
    const d = await run(raw);
    assert.equal(d.quarter, '2025Q3');
    const before = cso.get(raw, { ...ALL, C03004: 'Dublin', TLIST: '2024Q3' });
    const now = cso.get(raw, { ...ALL, C03004: 'Dublin', TLIST: '2025Q3' });
    assert.equal(d.counties.dublin.change, Number((100 * (now - before) / before).toFixed(1)), 'compared with 2024Q3');
    assert.equal(Object.keys(d.counties).length, 26);
});

test('only the 26 counties of the Republic, and a county with no figure is left out', async () => {
    const raw = cso.set(cso.table('RIQ02'), { C03004: 'Leitrim', TLIST: '2025Q4' }, null);
    const d = await run(raw);
    assert.ok(!('leitrim' in d.counties));
    assert.ok(Object.keys(d.counties).every(id => ROI_IDS.includes(id)));
    assert.equal(Object.keys(d.counties).length, 25);
    assert.ok(d.source.name.includes('RTB'));
});

test('a county that is new has no change rather than a wrong one', async () => {
    const raw = cso.set(cso.table('RIQ02'), { C03004: 'Sligo', TLIST: '2024Q4' }, null);
    const d = await run(raw);
    assert.equal(d.counties.sligo.change, null);
    assert.equal(typeof d.counties.sligo.rent, 'number');
});

test('with no national row in the table, national is null', async () => {
    const d = await run();
    assert.equal(d.national, null);
});

test('an unrecognised response throws', async () => {
    mockHttp([[/ReadDataset/, '{"error":"nope"}']]);
    await assert.rejects(loadLayer('rents').fetchRents());
});

test('an empty table (no county has figures) throws', { todo: 'BUG: publishes quarter undefined and no counties instead of throwing' }, async () => {
    const raw = cso.table('RIQ02');
    raw.value = raw.value.map(() => null);
    await assert.rejects(run(raw));
});
