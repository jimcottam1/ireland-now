// Census 2022 broadband by council area: the whole CSO table as published (saved 19 November 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');
const { table, get } = require('./cso-helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

async function run(raw = table('SAP2022T15T2CTY')) {
    mockHttp([[/SAP2022T15T2CTY/, raw]]);
    return loadLayer('broadband').fetchBroadband();
}

const v = (raw, kind, area) => get(raw, { C03764: kind, C03789: area });

test('every county of the Republic gets a broadband share, council areas added together', async () => {
    const raw = table('SAP2022T15T2CTY');
    const d = await run(raw);
    assert.deepEqual(Object.keys(d.counties).sort(), [...ROI_IDS].sort());
    for (const [id, c] of Object.entries(d.counties)) assert.ok(c.broadband > 50 && c.broadband < 100, `${id}: ${c.broadband}%`);
    // Galway is the city and county councils together
    const sum = kind => v(raw, kind, 'Galway City Council') + v(raw, kind, 'Galway County Council');
    const expected = 100 * sum('Broadband') / (sum('Broadband') + sum('Other') + sum('No'));
    assert.equal(d.counties.galway.broadband, Number(expected.toFixed(1)));
    assert.equal(d.counties.galway.households, sum('Broadband') + sum('Other') + sum('No') + sum('Not stated'));
});

test('the national share comes from the table\'s own Ireland row', async () => {
    const raw = table('SAP2022T15T2CTY');
    const d = await run(raw);
    const n = kind => v(raw, kind, 'Ireland');
    assert.equal(d.national.broadband, Number((100 * n('Broadband') / (n('Broadband') + n('Other') + n('No'))).toFixed(1)));
    assert.ok(d.counties.dublin.broadband > d.counties.leitrim.broadband, 'Dublin is better connected than Leitrim');
});

test('a missing column or county fails, so the last good copy is kept', async () => {
    const renamed = table('SAP2022T15T2CTY');
    const dim = renamed.dimension[renamed.id.find(id => id.startsWith('C03764'))].category;
    dim.label[Object.keys(dim.label).find(k => dim.label[k] === 'Broadband')] = 'Fibre';
    await assert.rejects(run(renamed), /no broadband column/);

    const noLeitrim = table('SAP2022T15T2CTY');
    const areas = noLeitrim.dimension[noLeitrim.id.find(id => id.startsWith('C03789'))].category;
    areas.label[Object.keys(areas.label).find(k => areas.label[k] === 'Leitrim County Council')] = 'Somewhere Council';
    await assert.rejects(run(noLeitrim), /not a county/);
});
