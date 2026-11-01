// Census 2022: age, Irish and commuting by county, from trimmed copies of the real CSO tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');
const cso = require('./cso-helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const TABLES = ['F1020', 'FY095', 'F7065'];
const run = async (tables = {}) => {
    mockHttp(TABLES.map(t => [new RegExp(`ReadDataset/${t}/`), tables[t] || cso.table(t)]));
    return loadLayer('census').fetchCensus();
};
const pct = (part, whole) => Number((100 * part / whole).toFixed(1));

const DUBLIN = ['Dublin City Council', 'Dún Laoghaire Rathdown County Council', 'Fingal County Council', 'South Dublin County Council'];
const CORK = ['Cork City Council', 'Cork County Council'];
const GALWAY = ['Galway City Council', 'Galway County Council'];

/** Sum of a census figure over several council areas. */
const over = (raw, areaDim, areas, picks) => areas.reduce((s, a) => s + cso.get(raw, { [areaDim]: a, ...picks }), 0);

test('age shares: Dublin combines its four councils, both sexes, ages grouped correctly', async () => {
    const raw = cso.table('F1020');
    const d = await run({ F1020: raw });
    const age = a => over(raw, 'C03789', DUBLIN, { C02199: 'Both sexes', C02076: a });
    const all = age('All ages');
    const under15 = age('0 - 4 years') + age('5 - 9 years') + age('10 - 14 years');
    const over65 = ['65 - 69 years', '70 - 74 years', '75 - 79 years', '80 - 84 years', '85 years and over'].reduce((s, a) => s + age(a), 0);
    assert.equal(d.counties.dublin.under15, pct(under15, all));
    assert.equal(d.counties.dublin.over65, pct(over65, all));
    assert.equal(d.counties.dublin.aged3plus, Math.round(all - 0.6 * age('0 - 4 years')));
    assert.ok(all > 1.4e6 && all < 1.6e6, `Dublin has about 1.5 million people, got ${all}`);
    assert.ok(d.counties.dublin.under15 > 15 && d.counties.dublin.under15 < 25);
});

test('Cork and Galway city and county are combined; Limerick and Waterford are already whole', async () => {
    const raw = cso.table('F1020');
    const d = await run({ F1020: raw });
    const all = areas => over(raw, 'C03789', areas, { C02199: 'Both sexes', C02076: 'All ages' });
    const small = areas => over(raw, 'C03789', areas, { C02199: 'Both sexes', C02076: '0 - 4 years' });
    assert.equal(d.counties.cork.aged3plus, Math.round(all(CORK) - 0.6 * small(CORK)));
    assert.equal(d.counties.galway.aged3plus, Math.round(all(GALWAY) - 0.6 * small(GALWAY)));
    assert.ok(d.counties.cork.aged3plus > 2 * Math.round(all(['Cork City Council']) - 0.6 * small(['Cork City Council'])), 'not just the city');
    assert.equal(d.counties.limerick.aged3plus, Math.round(all(['Limerick City & County Council']) - 0.6 * small(['Limerick City & County Council'])));
    assert.equal(d.counties.waterford.aged3plus, Math.round(all(['Waterford City & County Council']) - 0.6 * small(['Waterford City & County Council'])));
});

test('Irish: speakers and good speakers as a share of everyone aged 3 and over', async () => {
    const f1020 = cso.table('F1020');
    const raw = cso.table('FY095');
    const d = await run({ F1020: f1020, FY095: raw });
    const lvl = (areas, l) => over(raw, 'C03789', areas, { STATISTIC: 'Total Population aged 3 years and over', C02199: 'Both sexes', C02076: 'All ages', C04105: l });
    const aged3plus = d.counties.dublin.aged3plus;
    assert.equal(d.counties.dublin.irishSpeakers, pct(lvl(DUBLIN, 'Speaks Irish - Total'), aged3plus));
    assert.equal(d.counties.dublin.irishWell, pct(lvl(DUBLIN, 'Speaks Irish - Very well') + lvl(DUBLIN, 'Speaks Irish - Well'), aged3plus));
    // "Not well" and "not stated" are not good speakers
    assert.ok(d.counties.dublin.irishWell < d.counties.dublin.irishSpeakers);
    assert.equal(d.counties.galway.irishSpeakers, pct(lvl(GALWAY, 'Speaks Irish - Total'), d.counties.galway.aged3plus));
    assert.ok(d.counties.galway.irishSpeakers > d.counties.dublin.irishSpeakers - 20 && d.counties.galway.irishSpeakers < 100);
});

test('commuting: shares of people at work, by car, public transport and on foot or bike', async () => {
    const raw = cso.table('F7065');
    const d = await run({ F7065: raw });
    const at = (areas, m) => over(raw, 'C04104', areas, { STATISTIC: 'Population aged 15 years and over at work', C02199: 'Both sexes', C02734: m });
    const dublin = ['Dublin City', 'Dún Laoghaire-Rathdown', 'Fingal', 'South Dublin'];
    const total = at(dublin, 'All means of travel');
    assert.equal(d.counties.dublin.commuteCar, pct(at(dublin, 'Motor car: Driver') + at(dublin, 'Motor car: Passenger'), total));
    assert.equal(d.counties.dublin.commutePublic, pct(at(dublin, 'Bus, minibus or coach') + at(dublin, 'Train, DART or LUAS'), total));
    assert.equal(d.counties.dublin.commuteActive, pct(at(dublin, 'On foot') + at(dublin, 'Bicycle'), total));
    // Vans and motorbikes are none of these
    assert.ok(d.counties.dublin.commuteCar + d.counties.dublin.commutePublic + d.counties.dublin.commuteActive < 100);
    const galway = ['Galway City', 'Galway County'];
    assert.equal(d.counties.galway.commuteCar, pct(at(galway, 'Motor car: Driver') + at(galway, 'Motor car: Passenger'), at(galway, 'All means of travel')));
    assert.equal(d.counties.cork.commuteCar, pct(at(['Cork City and Cork County'], 'Motor car: Driver') + at(['Cork City and Cork County'], 'Motor car: Passenger'), at(['Cork City and Cork County'], 'All means of travel')));
});

test('commuting counts both sexes, not men only', async () => {
    const raw = cso.table('F7065');
    const male = cso.table('F7065');
    cso.copy(male, 'C02199', 'Male', 'Both sexes');    // make "Both sexes" hold the men's figures
    const a = await run({ F7065: raw });
    const b = await run({ F7065: male });
    assert.notEqual(a.counties.dublin.commuteCar, b.counties.dublin.commuteCar);
});

test('only the 26 counties of the Republic, with every figure filled in', async () => {
    const d = await run();
    assert.deepEqual(Object.keys(d.counties).sort(), [...ROI_IDS].sort());
    for (const [id, c] of Object.entries(d.counties)) {
        for (const key of ['under15', 'over65', 'aged3plus', 'irishSpeakers', 'irishWell', 'commuteCar', 'commutePublic', 'commuteActive']) {
            assert.equal(typeof c[key], 'number', `${id}.${key}`);
        }
        assert.ok(c.under15 + c.over65 < 100);
        assert.ok(c.irishSpeakers <= 100);
    }
    assert.equal(d.census, 2022);
    assert.equal(d.censusDate, '2022-04-03');
    assert.ok(d.source.name.includes('Census 2022'));
});

test('an unrecognised response throws', async () => {
    mockHttp([[/ReadDataset/, '{"error":"nope"}']]);
    await assert.rejects(loadLayer('census').fetchCensus());
});

test('a table with no figures at all throws', { todo: 'BUG: publishes every county with null shares and zero population instead of throwing' }, async () => {
    const raw = cso.table('F1020');
    raw.value = raw.value.map(() => null);
    await assert.rejects(run({ F1020: raw }));
});
