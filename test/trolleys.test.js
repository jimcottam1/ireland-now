// HSE TrolleyGAR is read from a web page, so these tests catch a change in its layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { COUNTY_IDS } = require('../scripts/lib/geo');

test('reads every hospital from a saved TrolleyGAR page, and the totals add up', async () => {
    mockHttp([[/uec\.hse\.ie/, fixture('trolleygar.html')]]);
    const d = await loadLayer('trolleys').fetchTrolleys();

    assert.ok(d.hospitals.length >= 20, `only ${d.hospitals.length} hospitals`);
    for (const h of d.hospitals) {
        assert.equal(h.ed + h.ward, h.total, `${h.name}: ED + ward should equal total`);
        assert.ok(COUNTY_IDS.includes(h.county), `${h.name} has no county`);
    }
    const sum = d.hospitals.reduce((s, h) => s + h.total, 0);
    assert.equal(d.national.total, sum, 'hospitals should add up to the national total');
    assert.equal(d.national.ed + d.national.ward, d.national.total);

    // The page gives a weekday; the layer works out the date of the latest such day
    assert.match(d.reportDate, /^\d{4}-\d{2}-\d{2}$/);
    const weekday = new Date(d.reportDate + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    assert.ok(d.reported.includes(weekday), `report date ${d.reportDate} should be a ${d.reported}`);

    const countyTotal = Object.values(d.counties).reduce((s, c) => s + c.total, 0);
    assert.equal(countyTotal, sum, 'county totals should cover every hospital');
});

test('skips a hospital row whose numbers don\'t add up (a sign the columns have shifted)', async () => {
    const html = fixture('trolleygar.html').toString().replace(/<!--[\s\S]*?-->/g, '');
    // Change Beaumont's total so ED + ward no longer equals it
    const start = html.indexOf('Beaumont Hospital');
    const cells = [...html.slice(start).matchAll(/<td[^>]*>\s*(\d+)\s*<\/td>/g)].slice(0, 3);
    const total = cells[2];
    const at = start + total.index;
    const broken = html.slice(0, at) + total[0].replace(`>${total[1]}<`, `>${Number(total[1]) + 7}<`) + html.slice(at + total[0].length);
    mockHttp([[/uec\.hse\.ie/, broken]]);
    const d = await loadLayer('trolleys').fetchTrolleys();
    assert.ok(!d.hospitals.some(h => h.name === 'Beaumont Hospital'), 'the inconsistent row is left out');
    assert.ok(d.hospitals.length >= 20, 'the rest still read');
});

test('refuses a page it no longer recognises instead of publishing nothing', async () => {
    mockHttp([[/uec\.hse\.ie/, '<html><body><h1>Maintenance</h1></body></html>']]);
    await assert.rejects(loadLayer('trolleys').fetchTrolleys(), /hospitals read/);
});
