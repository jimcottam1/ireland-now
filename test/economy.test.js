// Economy: headline CSO figures and the per-county Live Register and new homes, from trimmed copies of the real tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');
const cso = require('./cso-helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const TABLES = ['MUM01', 'CPM20', 'NDM01', 'LRM15', 'NDQ05'];

/** Serve the saved tables, with optional edited copies: tables = { MUM01: rawTable, ... }. */
function serve(tables = {}) {
    mockHttp(TABLES.map(t => [new RegExp(`ReadDataset/${t}/`), tables[t] || cso.table(t)]));
}
const run = async tables => { serve(tables); return loadLayer('economy').fetchEconomy(); };

const RATE = 'Seasonally Adjusted Monthly Unemployment Rate';
const unemp = (raw, month, extra = {}) => cso.get(raw, { STATISTIC: RATE, C02076: '15 - 74 years', C02199: 'Both sexes', TLIST: month, ...extra });

test('unemployment: 15-74 rate for both sexes, latest month against the same month a year before', async () => {
    const raw = cso.table('MUM01');
    const d = await run({ MUM01: raw });
    const u = d.national.unemployment;
    assert.equal(u.month, '2026 September');
    assert.equal(u.rate, unemp(raw, '2026 September'));
    assert.equal(u.yearAgo, unemp(raw, '2025 September'));
    // The distractor categories hold different numbers, so a wrong pick would show
    assert.notEqual(u.rate, unemp(raw, '2026 September', { C02199: 'Male' }));
    assert.notEqual(u.rate, unemp(raw, '2026 September', { C02076: '15 - 24 years' }));
    assert.ok(u.rate > 0 && u.rate < 30, 'a rate, not a head count');
});

test('unemployment: a latest month with no figure yet falls back to the last month that has one', async () => {
    const raw = cso.set(cso.table('MUM01'), { TLIST: '2026 September' }, null);
    const u = (await run({ MUM01: raw })).national.unemployment;
    assert.equal(u.month, '2026 August');
    assert.equal(u.rate, unemp(raw, '2026 August'));
    assert.equal(u.yearAgo, unemp(raw, '2025 August'), 'the year-ago month moves with it');
});

test('inflation: the 12-month change in All Items, not the monthly change or a sub-index', async () => {
    const raw = cso.table('CPM20');
    const d = await run({ CPM20: raw });
    const twelve = 'Percentage change over 12 months for Consumer Price Index';
    assert.equal(d.national.inflation.month, '2026 September');
    assert.equal(d.national.inflation.annual, cso.get(raw, { STATISTIC: twelve, C04624: 'All Items', TLIST: '2026 September' }));
    assert.notEqual(d.national.inflation.annual, cso.get(raw, { STATISTIC: twelve, C04624: 'Food and non-alcoholic beverages', TLIST: '2026 September' }));
    assert.notEqual(d.national.inflation.annual, cso.get(raw, { STATISTIC: cso.labels(raw, 'STATISTIC').find(l => /1 month/.test(l)), C04624: 'All Items', TLIST: '2026 September' }));

    cso.set(raw, { TLIST: '2026 September' }, null);
    const fallback = await run({ CPM20: raw });
    assert.equal(fallback.national.inflation.month, '2026 August');
});

test('new homes nationally: last 12 months against the 12 before', async () => {
    const raw = cso.table('NDM01');
    const months = cso.labels(raw, 'TLIST');
    const all = m => cso.get(raw, { C02342: 'All house types', TLIST: m });
    const total = ms => ms.reduce((s, m) => s + all(m), 0);
    const last12 = total(months.slice(-12));
    const prior12 = total(months.slice(-24, -12));
    const h = (await run({ NDM01: raw })).national.newHomes;
    assert.equal(h.month, months[months.length - 1]);
    assert.equal(h.monthCount, all(months[months.length - 1]));
    assert.equal(h.last12, last12);
    assert.equal(h.change, Number((100 * (last12 - prior12) / prior12).toFixed(1)));
});

test('Live Register: all ages, both sexes, per county, with the change on a year earlier', async () => {
    const raw = cso.table('LRM15');
    const d = await run({ LRM15: raw });
    assert.equal(d.liveRegisterMonth, '2026 September');
    const base = { C02076: 'All ages', C02199: 'Both sexes' };
    const now = cso.get(raw, { ...base, C03788: 'Co. Kerry', TLIST: '2026 September' });
    const before = cso.get(raw, { ...base, C03788: 'Co. Kerry', TLIST: '2025 September' });
    assert.equal(d.counties.kerry.liveRegister, now);
    assert.equal(d.counties.kerry.liveRegisterChange, Number((100 * (now - before) / before).toFixed(1)));
    assert.ok(d.counties.kerry.liveRegister > cso.get(raw, { ...base, C03788: 'Co. Kerry', C02076: 'Under 25 years', TLIST: '2026 September' }));
    assert.equal(d.counties.dublin.liveRegister, cso.get(raw, { ...base, C03788: 'Co. Dublin', TLIST: '2026 September' }));
    // The "Ireland" total row is not a county
    assert.ok(!Object.values(d.counties).some(c => c.liveRegister === cso.get(raw, { ...base, C03788: 'Ireland', TLIST: '2026 September' })));
});

test('Live Register uses the latest month the national total has, and compares like with like', async () => {
    const raw = cso.set(cso.table('LRM15'), { TLIST: '2026 September' }, null);
    const d = await run({ LRM15: raw });
    assert.equal(d.liveRegisterMonth, '2026 August');
    const base = { C02076: 'All ages', C02199: 'Both sexes', C03788: 'Co. Mayo' };
    assert.equal(d.counties.mayo.liveRegister, cso.get(raw, { ...base, TLIST: '2026 August' }));
    const before = cso.get(raw, { ...base, TLIST: '2025 August' });
    assert.equal(d.counties.mayo.liveRegisterChange, Number((100 * (d.counties.mayo.liveRegister - before) / before).toFixed(1)));
});

test('new homes by county: council areas are combined into counties, over the latest four quarters', async () => {
    const raw = cso.table('NDQ05');
    const d = await run({ NDQ05: raw });
    const quarters = cso.labels(raw, 'TLIST').slice(-4);
    assert.equal(d.newHomesPeriod, `${quarters[0]} to ${quarters[3]}`);
    const council = name => quarters.reduce((s, q) => s + cso.get(raw, { C03789: name, TLIST: q }), 0);

    const dublin = ['Dublin City Council', 'Dún Laoghaire Rathdown County Council', 'Fingal County Council', 'South Dublin County Council'];
    assert.equal(d.counties.dublin.newHomes, dublin.reduce((s, n) => s + council(n), 0));
    assert.ok(d.counties.dublin.newHomes > council('Dublin City Council'), 'all four Dublin councils, not just the city');
    assert.equal(d.counties.cork.newHomes, council('Cork City Council') + council('Cork County Council'));
    assert.equal(d.counties.galway.newHomes, council('Galway City Council') + council('Galway County Council'));
    assert.equal(d.counties.limerick.newHomes, council('Limerick City & County Council'));
    assert.equal(d.counties.waterford.newHomes, council('Waterford City & County Council'));
    assert.equal(d.counties.leitrim.newHomes, council('Leitrim County Council'));
    // Not the nationwide total, and nothing is counted twice
    const national = quarters.reduce((s, q) => s + cso.get(raw, { C03789: 'Ireland', TLIST: q }), 0);
    const added = Object.values(d.counties).reduce((s, c) => s + (c.newHomes || 0), 0);
    assert.equal(added, national);
});

test('new homes by county: a quarter the national total does not have yet is left out', async () => {
    const raw = cso.set(cso.table('NDQ05'), { TLIST: '2026Q3' }, null);
    const d = await run({ NDQ05: raw });
    assert.equal(d.newHomesPeriod, '2025Q3 to 2026Q2');
});

test('only the 26 counties of the Republic appear', async () => {
    const d = await run();
    assert.deepEqual(Object.keys(d.counties).sort(), [...ROI_IDS].sort());
    for (const c of Object.values(d.counties)) {
        assert.equal(typeof c.liveRegister, 'number');
        assert.equal(typeof c.newHomes, 'number');
    }
    assert.ok(d.source.name.includes('CSO'));
    assert.ok(d.updatedAt);
});

test('an empty or unrecognised table throws rather than publishing nothing', async () => {
    const empty = cso.table('MUM01');
    empty.value = empty.value.map(() => null);
    await assert.rejects(run({ MUM01: empty }));

    const emptyHomes = cso.table('NDQ05');
    emptyHomes.value = emptyHomes.value.map(() => null);
    await assert.rejects(run({ NDQ05: emptyHomes }));

    mockHttp([[/ReadDataset/, '{"error":"table not found"}']]);
    await assert.rejects(loadLayer('economy').fetchEconomy());
});
