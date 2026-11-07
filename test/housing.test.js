// Property Price Register: a sample of the real file (its header, encoding and every 100th sale since
// November 2024), zipped here the way the register publishes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const csv = fixture('ppr-sample.csv');
const zipOf = buffer => { const z = new AdmZip(); z.addFile('PPR-ALL.csv', buffer); return z.toBuffer(); };

async function run(t, buffer = csv, now = '2026-11-07T12:00:00Z') {
    freezeClock(t, now);
    mockHttp([[/propertypriceregister\.ie/, zipOf(buffer)]]);
    return loadLayer('housing').fetchHousing();
}

const lines = csv.toString('latin1').split(/\r?\n/);
const without = test => Buffer.from(lines.filter(l => !test(l)).join('\r\n'), 'latin1');

test('every county gets a median price from the sample', async t => {
    const d = await run(t);
    assert.deepEqual(Object.keys(d.counties).sort(), [...ROI_IDS].sort());
    for (const [id, c] of Object.entries(d.counties)) {
        assert.ok(c.median > 50000 && c.median < 2000000, `${id} median ${c.median}`);
        assert.ok(c.sales > 0);
    }
    const newest = lines.map(l => l.match(/^"(\d\d)\/(\d\d)\/(\d{4})"/)).filter(Boolean).map(([, dd, mm, yyyy]) => `${yyyy}-${mm}-${dd}`).sort().at(-1);
    assert.equal(d.latestSale, newest);
    assert.ok(d.national.median > 200000);
});

test('a renamed column fails rather than publishing nothing', async t => {
    const renamed = Buffer.from(csv.toString('latin1').replace('Date of Sale (dd/mm/yyyy)', 'Sale date'), 'latin1');
    await assert.rejects(run(t, renamed), /columns/);
});

test('a county missing from the file fails', async t => {
    await assert.rejects(run(t, without(l => /"Leitrim"/.test(l))), /leitrim/);
});

test('a register that has stopped updating fails', async t => {
    await assert.rejects(run(t, csv, '2027-03-01T12:00:00Z'), /latest sale/);
});

test('a zip with no CSV in it fails', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    const z = new AdmZip();
    z.addFile('readme.txt', Buffer.from('moved'));
    mockHttp([[/propertypriceregister\.ie/, z.toBuffer()]]);
    await assert.rejects(loadLayer('housing').fetchHousing(), /no CSV/);
});
