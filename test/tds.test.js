// TDs from the Oireachtas API: a saved answer (7 November 2026) for five constituencies, including two
// TDs who left the Dáil (Catherine Connolly, Paschal Donohoe) and the two by-election winners who replaced them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

const raw = JSON.parse(fixture('oireachtas-members.json'));

async function run(body = raw) {
    mockHttp([[/api\.oireachtas\.ie\/v1\/members/, body]]);
    return loadLayer('tds').fetchTds();
}

test('TDs who have left the Dáil are not listed', async () => {
    const d = await run();
    const names = d.tds.map(t => t.name);
    assert.ok(!names.includes('Catherine Connolly'), 'left on 25 October 2025');
    assert.ok(!names.includes('Paschal Donohoe'), 'left on 21 November 2025');
    assert.ok(names.includes('Seán Kyne') && names.includes('Daniel Ennis'), 'by-election winners are listed');
    assert.equal(d.tds.length, 22);
});

test('each constituency has its real number of seats', async () => {
    const d = await run();
    const seats = c => d.tds.filter(t => t.constituency === c).length;
    assert.equal(seats('Galway West'), 5);
    assert.equal(seats('Dublin Central'), 4);
    assert.equal(seats('Kerry'), 5);
    assert.equal(d.counties.galway.tds, 5);
    assert.deepEqual(d.counties.galway.constituencies, ['Galway West']);
});

test('party and office come from the current membership', async () => {
    const d = await run();
    const mlm = d.tds.find(t => t.name === 'Mary Lou McDonald');
    assert.equal(mlm.party, 'Sinn Féin');
    assert.deepEqual(mlm.counties, ['dublin']);
    assert.match(mlm.url, /^https:\/\/www\.oireachtas\.ie\/en\/members\/member\//);
});

test('more TDs in a constituency than it has seats fails, so the last good copy is kept', async () => {
    const twice = { ...raw, results: [...raw.results, ...raw.results.filter(r => r.member.fullName === 'Norma Foley').map(r => ({ member: { ...r.member, memberCode: 'Extra-TD' } }))] };
    await assert.rejects(run(twice), /Kerry has 6 TDs/);
});

test('an empty answer fails', async () => {
    await assert.rejects(run({ results: [] }), /no TDs/);
});
