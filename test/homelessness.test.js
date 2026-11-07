// Department of Housing monthly homelessness reports: one CSV per month, by region, found from its
// dataset page on opendata.housing.gov.ie (the portal's /api/ is closed to robots). Saved files: August 2026 and 2025.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const page = fixture('homelessness-dataset-page.html').toString();
const aug2026 = fixture('homelessness-august-2026.csv').toString();
const aug2025 = fixture('homelessness-august-2025.csv').toString();
const CSV_2026 = page.match(/https:\/\/opendata\.housing\.gov\.ie\/dataset\/[^"]+\.csv/)[0];
const CSV_2025 = 'https://opendata.housing.gov.ie/dataset/f5e73cb5/resource/d0804c87/download/homelessness-report-august-2025.csv';

// Only August is published: later months answer 404, as the portal does
function routes({ thisYear = aug2026, lastYear = aug2025, requested = [] } = {}) {
    return [
        [/./, url => {
            requested.push(url);
            if (url === CSV_2026) return thisYear;
            if (url === CSV_2025) return lastYear;
            if (/\/dataset\/homelessness-report-august-2026$/.test(url)) return page;
            if (/\/dataset\/homelessness-report-august-2025$/.test(url)) return page.split(CSV_2026).join(CSV_2025);
            throw new Error(`HTTP 404 from opendata.housing.gov.ie (${url})`);
        }]
    ];
}

test('finds the newest month by its dataset page, not the API', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    const requested = [];
    mockHttp(routes({ requested }));
    const d = await loadLayer('homelessness').fetchHomelessness();
    assert.equal(d.month, '2026-08');
    assert.ok(requested.every(u => !/\/api\//.test(u)), 'never uses the portal API');
    assert.ok(requested.some(u => /homelessness-report-october-2026$/.test(u)), 'tries the most recent months first');
});

test('regions add up and every county in the Republic belongs to exactly one', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    mockHttp(routes());
    const d = await loadLayer('homelessness').fetchHomelessness();
    assert.equal(Object.keys(d.regions).length, 9);
    const members = Object.values(d.regions).flatMap(r => r.counties);
    assert.deepEqual([...members].sort(), [...ROI_IDS].sort());
    assert.equal(d.counties.tipperary.region, 'south-east');
    assert.equal(d.counties.kildare.region, 'mid-east');

    const dub = d.regions.dublin;
    assert.equal(dub.adults, 8271);
    assert.equal(dub.children, 4158);
    assert.equal(dub.families, 1899);
    assert.equal(dub.people, 8271 + 4158);
    const sum = key => Object.values(d.regions).reduce((s, r) => s + r[key], 0);
    assert.equal(d.national.people, sum('people'));
    assert.equal(d.national.adults, sum('adults'));
});

test('change on a year earlier comes from the same month last year', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    mockHttp(routes());
    const d = await loadLayer('homelessness').fetchHomelessness();
    const dub2025 = 7969 + 3813;
    assert.equal(d.regions.dublin.change, Number((100 * (8271 + 4158 - dub2025) / dub2025).toFixed(1)));
    assert.ok(d.national.change != null);
});

test('a missing year-earlier file just leaves the change out', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    mockHttp(routes({ lastYear: null }).map(([p, f]) => [p, url => { if (url === CSV_2025) throw new Error('HTTP 404'); return f(url); }]));
    const d = await loadLayer('homelessness').fetchHomelessness();
    assert.equal(d.regions.dublin.change, null);
    assert.equal(d.national.change, null);
});

test('a file with a missing region or changed columns fails, so the last good copy is kept', async t => {
    freezeClock(t, '2026-11-07T12:00:00Z');
    mockHttp(routes({ thisYear: aug2026.split('\n').filter(l => !/^West,/.test(l)).join('\n') }));
    await assert.rejects(loadLayer('homelessness').fetchHomelessness(), /West/);
    mockHttp(routes({ thisYear: aug2026.replace('Number of Dependants in Families', 'Children') }));
    await assert.rejects(loadLayer('homelessness').fetchHomelessness(), /columns/);
    mockHttp(routes({ thisYear: aug2026.replace('Dublin,8271', 'Dublin,8x71') }));
    await assert.rejects(loadLayer('homelessness').fetchHomelessness(), /number/);
});

test('no report in the last six months fails', async t => {
    freezeClock(t, '2027-06-01T12:00:00Z');
    mockHttp(routes());
    await assert.rejects(loadLayer('homelessness').fetchHomelessness(), /no homelessness report/i);
});
