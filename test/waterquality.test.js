// EPA river and lake status 2019–2024: every lake (812) and every third river stretch plus all rated Bad and the
// three Unassigned, as published (saved 19 November 2026), without the period column.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const rivers = JSON.parse(fixture('epa-wfd-rivers.json'));
const lakes = JSON.parse(fixture('epa-wfd-lakes.json'));

async function run(r = rivers, l = lakes) {
    mockHttp([[/WFD_RWBStatus_20192024/, r], [/WFD_LWBStatus_20192024/, l]]);
    return loadLayer('waterquality').fetchWaterQuality();
}

test('every rated river stretch and lake becomes a dot in a county, in a separate file', async () => {
    const d = await run();
    const points = d.files['waterquality-points.json'];
    assert.ok(points.length > 1800, `${points.length} points`);
    for (const [kind, name, status, county, lat, lon] of points) {
        assert.ok(['river', 'lake'].includes(kind));
        assert.ok(['High', 'Good', 'Moderate', 'Poor', 'Bad'].includes(status), `${name}: ${status}`);
        assert.ok(ROI_IDS.includes(county), `${name} has county ${county}`);
        assert.ok(lat > 51.3 && lat < 55.5 && lon > -10.7 && lon < -5.9, `${name} at ${lat}, ${lon}`);
    }
    assert.ok(!points.some(p => p[2] === 'Unassigned'), 'unrated stretches are left out');
    assert.equal(d.bodies, undefined, 'the main file stays small');
});

test('names are tidied and the Silver at Kilcormac lands in Offaly', async () => {
    const d = await run();
    const silver = d.files['waterquality-points.json'].find(p => p[1] === 'Silver (Kilcormac)');
    assert.ok(silver, 'SILVER (KILCORMAC)_050 becomes Silver (Kilcormac)');
    assert.equal(silver[3], 'offaly');
});

test('counts by status add up, with the share rated Good or High', async () => {
    const d = await run();
    const points = d.files['waterquality-points.json'];
    const total = Object.values(d.counties).reduce((n, c) => n + Object.values(c.river).reduce((a, b) => a + b, 0) + Object.values(c.lake).reduce((a, b) => a + b, 0), 0);
    assert.equal(total, points.length);
    const r = d.national.river;
    assert.equal(d.national.riverGood, Math.round(100 * (r.High + r.Good) / Object.values(r).reduce((a, b) => a + b, 0)));
    assert.ok(d.national.lakeGood > d.national.riverGood, 'lakes do better than rivers, as the EPA reports');
});

test('an unknown status, a missing position or a short answer fails', async () => {
    const odd = structuredClone(rivers);
    odd.features[0].properties.Status = 'Excellent';
    await assert.rejects(run(odd), /unknown status "Excellent"/);
    const lost = structuredClone(lakes);
    delete lost.features[5].properties.easting;
    await assert.rejects(run(rivers, lost), /has no position/);
    await assert.rejects(run({ ...rivers, features: rivers.features.slice(0, 200) }), /only \d+ rivers/);
    await assert.rejects(run({ error: 'down' }), /not recognised/);
});
