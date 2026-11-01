const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

// Saved from the live service: newest date 23 Oct 2026, counts for 24 Sep to 23 Oct 2026
function mock({ newest = fixture('planning-newest.json'), byAuth = fixture('planning-newest-by-authority.json'), counts = fixture('planning-counts.json'), seen } = {}) {
    mockHttp([[/FeatureServer/, url => {
        const p = new URL(url).searchParams;
        seen?.push(p);
        if (!p.get('groupByFieldsForStatistics')) return newest;
        return /"count"/.test(p.get('outStatistics')) ? counts : byAuth;
    }]]);
}

const find = (r, id, start) => r.counties[id].authorities.find(a => a.name.startsWith(start));

test('counts per county, adding the Dublin, Cork and Galway councils together', async () => {
    mock();
    const r = await loadLayer('planning').fetchPlanning();
    assert.deepEqual(r.period, { from: '2026-09-24', to: '2026-10-23' });
    assert.equal(r.sourceTime, '2026-10-23T00:00:00.000Z');
    assert.equal(r.counties.dublin.authorities.length, 4);
    const sum = ['Dublin City', 'Dun Laoghaire', 'Fingal', 'South Dublin'].reduce((s, n) => s + find(r, 'dublin', n).applications, 0);
    assert.equal(r.counties.dublin.applications, sum);
    assert.equal(find(r, 'dublin', 'Dun Laoghaire').applications, 161);
    assert.equal(find(r, 'dublin', 'South Dublin').applications, 94);
    assert.equal(r.counties.cork.authorities.length, 2);
    assert.equal(r.counties.cork.applications, 266);
    assert.equal(r.counties.galway.applications, 32 + 159);
    assert.equal(r.counties.carlow.applications, 36);
    assert.equal(r.counties.tipperary.applications, 122);
    assert.equal(r.counties.waterford.applications, 97);
    assert.equal(r.counties.limerick.applications, 93);
    assert.equal(Object.keys(r.counties).length, 26);
});

test('a county with a stale council feed is incomplete, and the council is named with its newest date', async () => {
    mock();
    const r = await loadLayer('planning').fetchPlanning();
    assert.equal(r.counties.dublin.incomplete, true);
    assert.equal(find(r, 'dublin', 'Dublin City').newest, '2026-07-30');
    assert.equal(find(r, 'dublin', 'Fingal').newest, '2026-09-08');
    assert.equal(r.counties.cork.incomplete, true);
    assert.equal(find(r, 'cork', 'Cork City').applications, 0);
    assert.equal(find(r, 'cork', 'Cork City').newest, '2025-11-04');
    assert.equal(r.counties.kerry.incomplete, false);
    assert.equal(r.counties.carlow.incomplete, false);
    assert.equal(r.counties.limerick.incomplete, false);
});

test('a feed 21 days behind is still complete, 22 days behind is not', async () => {
    const by = JSON.parse(fixture('planning-newest-by-authority.json'));
    const day = 86400000;
    const top = JSON.parse(fixture('planning-newest.json')).features[0].attributes.mx;
    for (const f of by.features) f.attributes.mx = top;
    const set = (name, ms) => { by.features.find(f => f.attributes.PlanningAuthority === name).attributes.mx = ms; };
    set('Kerry County Council', top - 21 * day);
    set('Mayo County Council', top - 22 * day);
    mock({ byAuth: by });
    const r = await loadLayer('planning').fetchPlanning();
    assert.equal(r.counties.kerry.incomplete, false);
    assert.equal(r.counties.mayo.incomplete, true);
    assert.equal(r.counties.dublin.incomplete, false);
});

test('asks only for grouped statistics over 30 days, never for record fields', async () => {
    const seen = [];
    mock({ seen });
    await loadLayer('planning').fetchPlanning();
    assert.equal(seen.length, 3);
    for (const p of seen) {
        assert.ok(p.get('outStatistics'));
        assert.equal(p.get('outFields'), null);
    }
    const w = seen.find(p => /count/.test(p.get('outStatistics'))).get('where');
    assert.match(w, /timestamp '2026-09-24'/);
    assert.match(w, /timestamp '2026-10-23'/);
});

test('throws on an unrecognised authority, an error answer or empty data', async () => {
    const by = JSON.parse(fixture('planning-newest-by-authority.json'));
    by.features[0].attributes.PlanningAuthority = 'Atlantis Council';
    mock({ byAuth: by });
    await assert.rejects(loadLayer('planning').fetchPlanning(), /Unrecognised/);

    mock({ newest: { error: { message: 'bad' } } });
    await assert.rejects(loadLayer('planning').fetchPlanning(), /unexpected/);

    mock({ newest: { features: [{ attributes: { mx: null } }] } });
    await assert.rejects(loadLayer('planning').fetchPlanning(), /newest date/);

    mock({ counts: { features: [] } });
    await assert.rejects(loadLayer('planning').fetchPlanning(), /empty/);
});
