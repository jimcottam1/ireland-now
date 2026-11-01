// Shared helpers every layer relies on: county lookups, Irish time, CSO JSON-stat, and the page script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { countyAt, countyFromName, countiesInName, COUNTY_IDS, ROI_IDS, NI_IDS } = require('../scripts/lib/geo');
const { dublinToIso } = require('../scripts/lib/time');
const { cube } = require('../scripts/lib/jsonstat');

test('32 counties: 26 in the Republic, 6 in Northern Ireland', () => {
    assert.equal(COUNTY_IDS.length, 32);
    assert.equal(ROI_IDS.length, 26);
    assert.deepEqual([...NI_IDS].sort(), ['antrim', 'armagh', 'down', 'fermanagh', 'londonderry', 'tyrone']);
});

test('countyAt finds the county for a point, including just off the coast', () => {
    assert.equal(countyAt(-6.26, 53.35), 'dublin');      // O'Connell Street
    assert.equal(countyAt(-8.47, 51.90), 'cork');        // Cork city
    assert.equal(countyAt(-5.93, 54.60), 'antrim');      // Belfast
    assert.equal(countyAt(-7.31, 54.99), 'londonderry'); // Derry
    assert.equal(countyAt(-10.25, 51.93), 'kerry', 'a pier just outside the simplified coastline');
    assert.equal(countyAt(-15.9, 53.07), null, 'the M6 buoy far out in the Atlantic');
});

test('countyFromName handles the ways sources write county names', () => {
    assert.equal(countyFromName('Co. Kilkenny'), 'kilkenny');
    assert.equal(countyFromName('Dún Laoghaire Rathdown County Council'), 'dublin');
    assert.equal(countyFromName('South Dublin County Council'), 'dublin');
    assert.equal(countyFromName('Limerick City & County Council'), 'limerick');
    assert.equal(countyFromName('Co. Derry'), 'londonderry');
    assert.equal(countyFromName('Laoighis'), 'laois');
    assert.equal(countyFromName('Ireland'), null);
    assert.deepEqual(countiesInName('Carlow-Kilkenny').sort(), ['carlow', 'kilkenny']);
});

test('dublinToIso follows Irish summer and winter time', () => {
    assert.equal(dublinToIso(2026, 7, 1, 12, 0), '2026-07-01T11:00:00.000Z', 'IST is UTC+1');
    assert.equal(dublinToIso(2026, 12, 1, 12, 0), '2026-12-01T12:00:00.000Z', 'GMT in winter');
});

test('cube reads a value from a JSON-stat dataset by category', () => {
    const raw = {
        id: ['STATISTIC', 'TLIST(M1)', 'C1'],
        size: [1, 2, 2],
        dimension: {
            STATISTIC: { category: { index: ['S'], label: { S: 'Rate' } } },
            'TLIST(M1)': { category: { index: ['202609', '202610'], label: { 202609: '2026 September', 202610: '2026 October' } } },
            C1: { category: { index: ['A', 'B'], label: { A: 'Both sexes', B: 'Male' } } }
        },
        value: [1, 2, 3, 4]
    };
    const c = cube(raw);
    assert.equal(c.value({ STATISTIC: 'S', 'TLIST(M1)': '202610', C1: 'A' }), 3);
    assert.equal(c.value({ STATISTIC: () => true, [c.dim('TLIST').id]: '202609', C1: label => /male/i.test(label) && !/both/i.test(label) }), 2);
    assert.equal(c.value({ STATISTIC: 'S', 'TLIST(M1)': 'nope', C1: 'A' }), null);
});

test('the page script (public/app.js) parses', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'app.js' }));
});

test('crowded-dot bubbles: only the dense overlays cluster, and bubbles grow with the count', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const clustered = new vm.Script(source.match(/const CLUSTERED = (\[[^\]]*\]);/)[1]).runInThisContext();
    assert.deepEqual([...clustered].sort(), ['bikes', 'buses', 'luas', 'rivers', 'water']);
    const bubbleSize = new vm.Script(source.match(/const bubbleSize = ([^;]+);/)[1]).runInThisContext();
    assert.ok(bubbleSize(3) < bubbleSize(30) && bubbleSize(30) < bubbleSize(300));
});

test('the page still works if the markercluster script is blocked', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.match(source, /const canCluster = typeof L\.markerClusterGroup === 'function'/);
    assert.match(source, /if \(canCluster && CLUSTERED\.includes\(name\)\)/);
    assert.equal((source.match(/L\.markerClusterGroup\(/g) || []).length, 1);   // only used inside the guarded branch
});
