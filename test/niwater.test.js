// NI Water is read from its service updates page; these tests catch a change in its layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { NI_IDS } = require('../scripts/lib/geo');

const KINDS = ['outage', 'restrictions', 'works', 'boil-water', 'do-not-drink'];

test('reads every incident from a saved NI Water page', async () => {
    const html = fixture('niwater.html').toString();
    mockHttp([[/niwater\.com/, html]]);
    const d = await loadLayer('niwater').fetchNiWater();

    const expected = (html.match(/data-event-id=/g) || []).length;
    assert.equal(d.notices.length, expected, 'one notice per incident on the page');
    for (const n of d.notices) {
        assert.ok(n.title, 'every notice has a title');
        assert.ok(KINDS.includes(n.kind), `unknown kind ${n.kind}`);
        assert.ok(n.lat > 54 && n.lat < 55.5 && n.lon > -8.3 && n.lon < -5.3, `${n.title} is outside Northern Ireland`);
        assert.ok(NI_IDS.includes(n.county), `${n.title} should be in a Northern Ireland county, got ${n.county}`);
        assert.ok(!n.updated || !Number.isNaN(Date.parse(n.updated)), 'updated is a date');
        assert.equal(n.issuer, 'NI Water');
    }
    if (d.notices.length) assert.ok(d.sourceTime, 'source time comes from the newest update');
});

test('a quiet day (no incidents) is fine', async () => {
    mockHttp([[/niwater\.com/, '<html><h1>Current Service Updates</h1><p>There are no incidents.</p></html>']]);
    const d = await loadLayer('niwater').fetchNiWater();
    assert.deepEqual(d.notices, []);
});

test('a page it no longer recognises fails, so the last good copy is kept', async () => {
    mockHttp([[/niwater\.com/, '<html><h1>Page not found</h1></html>']]);
    await assert.rejects(loadLayer('niwater').fetchNiWater(), /layout not recognised/);
});
