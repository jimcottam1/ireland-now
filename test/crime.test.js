// Crime: recorded crime by Garda division (CSO CJQ10), from a trimmed copy of the real table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');
const cso = require('./cso-helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const run = async (raw = cso.table('CJQ10')) => {
    mockHttp([[/ReadDataset\/CJQ10\//, raw]]);
    return loadLayer('crime').fetchCrime();
};

const topLevel = raw => cso.labels(raw, 'C02480').filter(l => /\(\d{2}\)\s*$/.test(l));
const divTotal = (raw, division, quarters) => quarters.reduce((s, q) =>
    s + topLevel(raw).reduce((t, o) => t + (cso.get(raw, { C02481: division, C02480: o, TLIST: q }) || 0), 0), 0);
const byName = (d, name) => d.divisions.find(x => x.name === name);

/** The real table only has the current divisions from 2025; give 2024 figures (half of 2025's) so every quarter has a year-earlier match. */
function withFullHistory(raw) {
    for (const n of ['1', '2', '3', '4']) cso.copy(raw, 'TLIST', `2025Q${n}`, `2024Q${n}`, v => v / 2);
    return raw;
}

test('the last four quarters with figures; the change uses only quarters that have a match a year earlier', async () => {
    const raw = cso.table('CJQ10');
    const d = await run(raw);
    assert.deepEqual(d.period, { from: '2025Q3', to: '2026Q2' });
    // Nothing was recorded for these divisions before 2025, so only 2026Q1 and 2026Q2 can be compared
    assert.deepEqual(d.changePeriod, { from: '2026Q1', to: '2026Q2' });
    assert.equal(d.published, raw.updated);

    const galway = byName(d, 'Galway');
    const recent = divTotal(raw, 'Galway Garda Division', ['2026Q1', '2026Q2']);
    const before = divTotal(raw, 'Galway Garda Division', ['2025Q1', '2025Q2']);
    assert.equal(galway.change, Number((100 * (recent - before) / before).toFixed(1)));
    // Comparing four recent quarters with two earlier ones would show a rise of about 100%; it must not
    assert.ok(Math.abs(galway.change) < 40, `${galway.change}% looks like unequal periods`);
});

test('when every quarter has a year-earlier match, the change covers all four', async () => {
    const raw = withFullHistory(cso.table('CJQ10'));
    const d = await run(raw);
    assert.deepEqual(d.changePeriod, { from: '2025Q3', to: '2026Q2' });
    const q = ['2025Q3', '2025Q4', '2026Q1', '2026Q2'];
    const recent = divTotal(raw, 'Kerry Garda Division', q);
    const before = divTotal(raw, 'Kerry Garda Division', ['2024Q3', '2024Q4', '2025Q1', '2025Q2']);
    assert.equal(byName(d, 'Kerry').change, Number((100 * (recent - before) / before).toFixed(1)));
    assert.ok(byName(d, 'Kerry').change > 20, 'the 2024 figures are half of 2025, so a clear rise');
});

test('one quarter missing a year earlier is dropped from both sides of the comparison', async () => {
    const raw = withFullHistory(cso.table('CJQ10'));
    cso.set(raw, { TLIST: '2025Q4' }, null);   // now 2025Q4 has no figures: it neither counts as a recent quarter nor a baseline
    const d = await run(raw);
    // Latest four quarters with data are 2025Q2, 2025Q3, 2026Q1, 2026Q2; 2025Q2 and 2025Q3 and the 2026 ones all have a year-earlier match
    assert.deepEqual(d.period, { from: '2025Q2', to: '2026Q2' });
    const q = ['2025Q2', '2025Q3', '2026Q1', '2026Q2'];
    const prev = ['2024Q2', '2024Q3', '2025Q1', '2025Q2'];
    const recent = divTotal(raw, 'Donegal Garda Division', q);
    const before = divTotal(raw, 'Donegal Garda Division', prev);
    assert.equal(byName(d, 'Donegal').change, Number((100 * (recent - before) / before).toFixed(1)));
});

test('the change is null when nothing can be compared', async () => {
    const raw = cso.table('CJQ10');
    for (const q of ['2025Q1', '2025Q2']) cso.set(raw, { TLIST: q }, null);
    const d = await run(raw);
    assert.equal(d.changePeriod, null);
    assert.ok(d.divisions.every(x => x.change === null));
});

test('totals add the top-level offence groups only, not sub-groups', async () => {
    const raw = cso.table('CJQ10');
    const d = await run(raw);
    const q = ['2025Q3', '2025Q4', '2026Q1', '2026Q2'];
    const total = divTotal(raw, 'Cork City Garda Division', q);
    assert.equal(byName(d, 'Cork City').total, total);
    // The table also has "Theft/taking of vehicle (081)", which is part of Theft (08); counting it would double up
    assert.ok(cso.labels(raw, 'C02480').some(l => /\(081\)/.test(l)));
    const g = byName(d, 'Cork City').groups;
    assert.deepEqual(Object.keys(g).sort(), ['assaults', 'burglary', 'damage', 'drugs', 'publicOrder', 'theft']);
    const grp = label => q.reduce((s, x) => s + cso.get(raw, { C02481: 'Cork City Garda Division', C02480: label, TLIST: x }), 0);
    assert.equal(g.theft, grp('Theft and related offences (08)'));
    assert.equal(g.assaults, grp('Attempts/threats to murder, assaults, harassments and related offences (03)'));
    assert.equal(g.burglary, grp('Burglary and related offences (07)'));
    assert.equal(g.drugs, grp('Controlled drug offences (10)'));
    assert.equal(g.damage, grp('Damage to property and to the environment  offences (12)'));
    assert.equal(g.publicOrder, grp('Public order and other social code offences (13)'));
});

test('divisions are named plainly and mapped onto the counties they cover', async () => {
    const d = await run();
    assert.equal(d.divisions.length, 21);
    assert.deepEqual(byName(d, 'Louth, Cavan, Monaghan').counties.sort(), ['cavan', 'louth', 'monaghan']);
    assert.deepEqual(byName(d, 'Laois Offaly').counties.sort(), ['laois', 'offaly']);
    assert.deepEqual(byName(d, 'Meath, Westmeath').counties.sort(), ['meath', 'westmeath'], 'Meath does not match inside Westmeath');
    assert.deepEqual(byName(d, 'Cork City').counties, ['cork']);
    assert.deepEqual(byName(d, 'Cork County').counties, ['cork']);
    const dublin = d.divisions.filter(x => /^Dublin /.test(x.name));
    assert.equal(dublin.length, 6);
    assert.ok(dublin.every(x => x.counties.length === 1 && x.counties[0] === 'dublin'));
    assert.ok(!d.divisions.some(x => /Garda Division|D\.M\.R\./.test(x.name)));
});

test('every county of the Republic is covered, none from Northern Ireland, and county lists point at divisions', async () => {
    const d = await run();
    assert.deepEqual(Object.keys(d.counties).sort(), [...ROI_IDS].sort());
    assert.equal(d.counties.dublin.length, 6);
    assert.equal(d.counties.cork.length, 2);
    for (const [id, idx] of Object.entries(d.counties)) {
        for (const i of idx) assert.ok(d.divisions[i].counties.includes(id), `${id} -> ${d.divisions[i].name}`);
    }
    assert.ok(d.source.name.includes('under reservation'));
});

test('an unrecognised response throws', async () => {
    mockHttp([[/ReadDataset/, '{"error":"nope"}']]);
    await assert.rejects(loadLayer('crime').fetchCrime());
});

test('a table with no figures at all throws', async () => {
    const raw = cso.table('CJQ10');
    raw.value = raw.value.map(() => null);
    await assert.rejects(run(raw));
});
