const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

// Saved from the live service with the layer's own queries: the window is 15 Sep to 14 Oct 2026
// (14 Oct is the earliest newest-date among the healthy councils), the month before is 16 Aug to 14 Sep.
const json = name => JSON.parse(fixture(name));
const DAY = 86400000;

function mock({ newest = json('planning-newest.json'), byAuth = json('planning-newest-by-authority.json'),
    counts = json('planning-counts.json'), previous = json('planning-counts-previous.json'), seen } = {}) {
    mockHttp([[/FeatureServer/, url => {
        const p = new URL(url).searchParams;
        seen?.push(p);
        if (!p.get('groupByFieldsForStatistics')) return newest;
        if (!/"count"/.test(p.get('outStatistics'))) return byAuth;
        return /^ReceivedDate >= timestamp '2026-09-15'/.test(p.get('where')) ? counts : previous;
    }]]);
}
const run = () => loadLayer('planning').fetchPlanning();
const find = (r, id, start) => r.counties[id].authorities.find(a => a.name.startsWith(start));
const row = (data, name) => data.features.find(f => f.attributes.PlanningAuthority === name);

test('counts per county over a window ending on the common date, adding the Dublin, Cork and Galway councils', async () => {
    mock();
    const r = await run();
    assert.deepEqual(r.period, { from: '2026-09-15', to: '2026-10-14' });
    assert.equal(r.sourceTime, '2026-10-23T00:00:00.000Z');
    const sum = a => json('planning-counts.json').features.filter(f => a.test(f.attributes.PlanningAuthority)).reduce((s, f) => s + f.attributes.n, 0);
    assert.equal(r.counties.dublin.authorities.length, 4);
    assert.equal(r.counties.dublin.applications, sum(/Dublin|Fingal|Dun Laoghaire/));
    assert.equal(r.counties.cork.applications, sum(/^Cork/));
    assert.equal(r.counties.galway.authorities.length, 2);
    assert.equal(r.counties.galway.applications, sum(/^Galway/));
    assert.equal(r.counties.carlow.applications, sum(/^Carlow/));
    assert.equal(Object.keys(r.counties).length, 26);
    assert.equal(r.counties.kerry.incomplete, false);
    assert.deepEqual(r.counties.kerry.missing, []);
});

test('the window ends on the earliest newest date among councils that are not stale', async () => {
    const by = json('planning-newest-by-authority.json');
    const top = json('planning-newest.json').features[0].attributes.mx;
    for (const f of by.features) f.attributes.mx = top;
    row(by, 'Kerry County Council').attributes.mx = top - 5 * DAY;     // healthy but behind: sets the end
    row(by, 'Mayo County Council').attributes.mx = top - 40 * DAY;     // stale: ignored for the end date
    mock({ byAuth: by });
    const r = await run();
    assert.equal(r.period.to, new Date(top - 5 * DAY).toISOString().slice(0, 10));
    assert.equal(r.period.from, new Date(top - 34 * DAY).toISOString().slice(0, 10));
    assert.equal(find(r, 'mayo', 'Mayo').issue, 'stale');
    assert.equal(r.counties.mayo.incomplete, true);
});

test('stale feeds are flagged: 21 days behind is fine, 22 is stale, and a null or future date is stale', async () => {
    const by = json('planning-newest-by-authority.json');
    const top = json('planning-newest.json').features[0].attributes.mx;
    for (const f of by.features) f.attributes.mx = top;
    row(by, 'Kerry County Council').attributes.mx = top - 21 * DAY;
    row(by, 'Mayo County Council').attributes.mx = top - 22 * DAY;
    row(by, 'Sligo County Council').attributes.mx = null;
    row(by, 'Clare County Council').attributes.mx = Date.UTC(2100, 0, 1);
    mock({ byAuth: by });
    const r = await run();
    assert.equal(r.counties.kerry.incomplete, false);
    assert.equal(r.counties.mayo.incomplete, true);
    assert.equal(r.counties.sligo.incomplete, true);
    assert.equal(find(r, 'sligo', 'Sligo').newest, null);
    assert.equal(find(r, 'sligo', 'Sligo').issue, 'stale');
    assert.equal(r.counties.clare.incomplete, true);
    assert.equal(r.counties.dublin.incomplete, false);
    assert.equal(r.period.to, new Date(top - 21 * DAY).toISOString().slice(0, 10));
});

test('stale councils in Dublin and Cork are named with their newest dates', async () => {
    mock();
    const r = await run();
    assert.equal(r.counties.dublin.incomplete, true);
    assert.equal(find(r, 'dublin', 'Dublin City').newest, '2026-07-30');
    assert.equal(find(r, 'dublin', 'Dublin City').issue, 'stale');
    assert.equal(find(r, 'dublin', 'Fingal').issue, 'stale');
    assert.equal(find(r, 'dublin', 'South Dublin').issue, null);
    assert.equal(r.counties.cork.incomplete, true);
    assert.equal(find(r, 'cork', 'Cork City').applications, 0);
    assert.equal(find(r, 'cork', 'Cork City').newest, '2025-11-04');
});

test('a trickle feed (well under its usual level) is incomplete, but a small council is not flagged', async () => {
    mock();
    const r = await run();
    const w = find(r, 'wexford', 'Wexford');
    assert.equal(w.issue, 'low');
    assert.equal(r.counties.wexford.incomplete, true);

    // 10 against 60: low. 5 against 19: previous too small to judge. 40 against 100: exactly 40%, fine.
    const counts = json('planning-counts.json'), previous = json('planning-counts-previous.json');
    const set = (d, name, n) => { row(d, name).attributes.n = n; };
    set(counts, 'Carlow County Council', 10); set(previous, 'Carlow County Council', 60);
    set(counts, 'Cavan County Council', 5); set(previous, 'Cavan County Council', 19);
    set(counts, 'Clare County Council', 40); set(previous, 'Clare County Council', 100);
    mock({ counts, previous });
    const r2 = await run();
    assert.equal(r2.counties.carlow.incomplete, true);
    assert.equal(find(r2, 'carlow', 'Carlow').issue, 'low');
    assert.equal(r2.counties.cavan.incomplete, false);
    assert.equal(r2.counties.clare.incomplete, false);
});

test('a council in the window counts but missing from the all-time list is flagged, not dropped or fatal', async () => {
    const by = json('planning-newest-by-authority.json');
    by.features = by.features.filter(f => f.attributes.PlanningAuthority !== 'Kerry County Council');
    mock({ byAuth: by });
    const r = await run();
    const k = find(r, 'kerry', 'Kerry');
    assert.equal(k.newest, null);
    assert.equal(k.issue, 'stale');
    assert.ok(k.applications > 0);
    assert.equal(r.counties.kerry.incomplete, true);
});

test('a council missing from every list makes its county incomplete, naming it; a whole missing county too', async () => {
    const by = json('planning-newest-by-authority.json'), counts = json('planning-counts.json'), previous = json('planning-counts-previous.json');
    for (const d of [by, counts, previous]) {
        d.features = d.features.filter(f => !/^(Fingal|Louth)/.test(f.attributes.PlanningAuthority));
    }
    mock({ byAuth: by, counts, previous });
    const r = await run();
    assert.equal(r.counties.dublin.incomplete, true);
    assert.deepEqual(r.counties.dublin.missing, ['Fingal County Council']);
    assert.equal(r.counties.louth.incomplete, true);
    assert.deepEqual(r.counties.louth.authorities, []);
    assert.deepEqual(r.counties.louth.missing, ['Louth County Council']);
    assert.equal(r.counties.louth.applications, 0);
    assert.equal(Object.keys(r.counties).length, 26);
});

test('asks only for grouped statistics, bounded by dates, never for record fields or geometry', async () => {
    const seen = [];
    mock({ seen });
    await run();
    assert.equal(seen.length, 4);
    const today = new Date().toISOString().slice(0, 10);
    for (const p of seen) {
        assert.ok(p.get('outStatistics'));
        assert.equal(p.get('outFields'), null);
        assert.equal(p.get('returnGeometry'), 'false');
        assert.match(p.get('where'), /PlanningAuthority IS NOT NULL/);
    }
    const newestQueries = seen.filter(p => /max/.test(p.get('outStatistics')));
    assert.equal(newestQueries.length, 2);
    for (const p of newestQueries) assert.equal(p.get('where').startsWith(`ReceivedDate <= timestamp '${today}'`), true);
    const windows = seen.filter(p => /count/.test(p.get('outStatistics'))).map(p => p.get('where'));
    assert.ok(windows.some(w => /timestamp '2026-09-15'.*< timestamp '2026-10-15'/.test(w)));
    assert.ok(windows.some(w => /timestamp '2026-08-16'.*< timestamp '2026-09-15'/.test(w)));
});

test('the map value for an incomplete county is null, so it is greyed out (front end)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const block = src.match(/planning: \{[\s\S]*?value: id => ([^\n]*)\n/)[1];
    assert.match(block, /incomplete \? null/);
});

test('throws on an unrecognised authority, an error answer, no usable date or empty data', async () => {
    const by = json('planning-newest-by-authority.json');
    by.features[0].attributes.PlanningAuthority = 'Atlantis Council';
    mock({ byAuth: by });
    await assert.rejects(run(), /Unrecognised/);

    mock({ newest: { error: { message: 'bad' } } });
    await assert.rejects(run(), /unexpected/);

    mock({ newest: { features: [{ attributes: { mx: null } }] } });
    await assert.rejects(run(), /newest date/);

    mock({ newest: { features: [{ attributes: { mx: Date.UTC(2100, 0, 1) } }] } });
    await assert.rejects(run(), /newest date/);

    mock({ counts: { features: [] }, previous: { features: [] } });
    await assert.rejects(run(), /empty/);
});
