// Uisce Éireann notices come from an ArcGIS layer; these tests use a saved answer (7 November 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const SAVED_AT = '2026-11-07T21:56:00Z';
const raw = JSON.parse(fixture('arcgis-water.json'));
const byId = Object.fromEntries(raw.features.map(f => [f.attributes.OBJECTID, f.attributes]));

async function run(t, body = raw) {
    freezeClock(t, SAVED_AT);
    const urls = [];
    mockHttp([[/arcgis\.com/, url => { urls.push(url); return body; }]]);
    const d = await loadLayer('water').fetchWater();
    return { d, urls };
}

test('asks the server for current notices only, so the record limit never cuts off old ones', async t => {
    const { urls } = await run(t);
    const where = new URL(urls[0]).searchParams.get('where');
    assert.match(where, /ENDDATE IS NULL/, 'open-ended notices are asked for');
    assert.match(where, /ENDDATE >=/, 'finished notices are left out on the server');
});

test('open-ended boil water and do-not-drink notices are kept, with no end date', async t => {
    const { d } = await run(t);
    const openHealth = raw.features.map(f => f.attributes)
        .filter(a => !a.ENDDATE && a.TITLE && !/^lifting\b/i.test(a.TITLE) && (a.BOILWATERNOTICE === 1 || a.DONOTDRINK === 1));
    assert.ok(openHealth.length >= 30, 'the saved answer has open-ended health notices');
    for (const a of openHealth) {
        const n = d.notices.find(x => x.id === a.OBJECTID);
        assert.ok(n, `${a.TITLE} (${a.OBJECTID}) is missing`);
        assert.equal(n.end, null);
        assert.ok(['boil-water', 'do-not-drink'].includes(n.kind), `${a.TITLE} should be a health notice, got ${n.kind}`);
    }
    assert.ok(d.counties.waterford.boilWater > 0, 'Waterford has a boil water notice');
});

test('open-ended works, untitled records and lifting notices are dropped', async t => {
    const { d } = await run(t);
    for (const n of d.notices) {
        const a = byId[n.id];
        assert.ok(a.TITLE, `untitled record ${n.id} published`);
        assert.ok(!/^lifting\b/i.test(a.TITLE), `lifting notice "${a.TITLE}" published as a warning`);
        if (!a.ENDDATE) assert.ok(['boil-water', 'do-not-drink', 'restrictions'].includes(n.kind), `open-ended ${n.kind} "${a.TITLE}" published`);
    }
});

test('dated notices are current or start within a week', async t => {
    const { d } = await run(t);
    const now = Date.parse(SAVED_AT);
    const dated = d.notices.filter(n => n.end);
    assert.ok(dated.length > 100);
    for (const n of dated) {
        assert.ok(Date.parse(n.end) >= now, `${n.title} has ended`);
        assert.ok(Date.parse(n.start) <= now + 7 * 86400000, `${n.title} starts more than a week away`);
        assert.equal(n.active, Date.parse(n.start) <= now);
    }
});

test('an answer cut short by the server fails, so the last good copy is kept', async t => {
    freezeClock(t, SAVED_AT);
    mockHttp([[/arcgis\.com/, { ...raw, exceededTransferLimit: true }]]);
    await assert.rejects(loadLayer('water').fetchWater(), /more notices than/);
});

test('an answer it does not recognise fails', async t => {
    freezeClock(t, SAVED_AT);
    mockHttp([[/arcgis\.com/, { error: { message: 'Invalid query' } }]]);
    await assert.rejects(loadLayer('water').fetchWater(), /ArcGIS: Invalid query/);
    mockHttp([[/arcgis\.com/, { nothing: true }]]);
    await assert.rejects(loadLayer('water').fetchWater(), /not recognised/);
});
