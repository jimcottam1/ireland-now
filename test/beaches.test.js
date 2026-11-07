// EPA bathing waters: a saved answer (7 November 2026, all 243 designated bathing waters).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const raw = JSON.parse(fixture('epa-beaches.json'));

async function run(body = raw) {
    mockHttp([[/data\.epa\.ie\/bw\/api/, body]]);
    return loadLayer('beaches').fetchBeaches();
}

test('reads every bathing water from a saved answer', async () => {
    const d = await run();
    assert.equal(d.beaches.length, raw.count);
    for (const b of d.beaches) assert.ok(ROI_IDS.includes(b.county), `${b.name} has county ${b.county}`);
    const counted = Object.values(d.counties).reduce((s, c) => s + c.beaches, 0);
    assert.equal(counted, raw.count, 'every beach is counted in a county');
    assert.ok(d.counties.donegal.beaches > 10);
});

test('a list shorter than the total the EPA reports fails (a page went missing)', async () => {
    await assert.rejects(run({ ...raw, list: raw.list.slice(0, 200) }), /200 of 243/);
});

test('an empty or unrecognised answer fails, so the last good copy is kept', async () => {
    await assert.rejects(run({ count: 0, list: [] }), /only 0/);
    await assert.rejects(run({ error: 'Not found' }), /not recognised/);
});
