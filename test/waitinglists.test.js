// NTPF waiting lists: the links on the open data page (saved 19 November 2026), the 2026 outpatient and
// inpatient/day-case files as published (January to October), and October 2025 cut from the 2025 files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');
const { csvObjects } = require('../scripts/lib/csv');

const page = String(fixture('ntpf-open-data-page.html'));
const files = {
    OPNational01_2026: String(fixture('ntpf-OPNational01-2026.csv')),
    IPDCNational01_2026: String(fixture('ntpf-IPDCNational01-2026.csv')),
    OPNational01_2025: String(fixture('ntpf-OPNational01-2025.csv')),
    IPDCNational01_2025: String(fixture('ntpf-IPDCNational01-2025.csv'))
};

async function run(override = {}) {
    const answers = { page, ...files, ...override };
    mockHttp([
        [/waiting-list-data\/open-data/, () => answers.page],
        [/OpenData_(\w+?_\d{4})(-\d+)?\.csv/, url => {
            const key = url.match(/OpenData_(\w+?_\d{4})(-\d+)?\.csv/)[1];
            if (!(key in answers)) throw new Error(`HTTP 404 from www.ntpf.ie (${key})`);
            return answers[key];
        }]
    ]);
    return loadLayer('waitinglists').fetchWaitingLists();
}

test('reads the newest month for every hospital and places each in a county', async () => {
    const d = await run();
    assert.equal(d.date, '2026-10-29');
    assert.ok(d.hospitals.length >= 44);
    for (const h of d.hospitals) assert.ok(ROI_IDS.includes(h.county), `${h.name} has county ${h.county}`);
    const beaumont = d.hospitals.find(h => h.name === 'Beaumont Hospital');
    assert.ok(beaumont.outpatients > 10000 && beaumont.inpatients > 1000);
    assert.ok(beaumont.outpatientsLong < beaumont.outpatients);
    // County totals add up to the national ones
    const total = Object.values(d.counties).reduce((s, c) => s + c.outpatients, 0);
    assert.equal(total, d.national.outpatients);
    assert.ok(d.counties.dublin.hospitals > 10);
});

test('adults and children are added together', async () => {
    const d = await run();
    const rows = csvObjects(files.OPNational01_2026).filter(r => r.ArchiveDate === '29/10/2026' && r.HospitalName === 'Beaumont Hospital');
    assert.deepEqual(rows.map(r => r.Adult_Child).sort(), ['Adult', 'Child']);
    const sum = rows.reduce((s, r) => s + Number(r.Total.replace(/,/g, '')), 0);
    assert.equal(d.hospitals.find(h => h.name === 'Beaumont Hospital').outpatients, sum);
});

test('compares with the same month a year earlier from last year\'s file', async () => {
    const d = await run();
    assert.equal(typeof d.national.outpatientsChange, 'number');
    assert.equal(typeof d.national.inpatientsChange, 'number');
});

test('without last year\'s file the change is left out, not guessed', async () => {
    const d = await run({ page: page.replace(/OpenData_(OP|IPDC)National01_2025[^"]*\.csv/g, 'missing.csv') });
    assert.equal(d.national.outpatientsChange, null);
});

test('a page with no file links fails, so the last good copy is kept', async () => {
    await assert.rejects(run({ page: '<html>Moved</html>' }), /no OPNational01 files/);
});

test('changed columns, bad numbers or bands that do not add up fail', async () => {
    await assert.rejects(run({ OPNational01_2026: files.OPNational01_2026.replace('HospitalName', 'Hospital') }), /columns changed/);
    await assert.rejects(run({ OPNational01_2026: files.OPNational01_2026.replace(',737,', ',n/a,') }), /not a number/);
    await assert.rejects(run({ OPNational01_2026: files.OPNational01_2026.replace(',737,', ',7370,') }), /don't add up/);
    // NTPF's bands are often one or two out from its total; that is accepted
    await run({ OPNational01_2026: files.OPNational01_2026.replace(',737,', ',738,') });
});

test('many unknown hospital names fail; one new hospital is counted nationally only', async () => {
    const renamed = files.OPNational01_2026.replace(/,(\w[^,]*) Hospital,/g, ',$1 Hosp.,');
    await assert.rejects(run({ OPNational01_2026: renamed }), /not recognised/);
    const one = files.OPNational01_2026.replaceAll('Bantry General Hospital', 'Bantry New Hospital');
    const d = await run({ OPNational01_2026: one });
    assert.equal(d.hospitals.find(h => h.name === 'Bantry New Hospital').county, null);
    const counted = Object.values(d.counties).reduce((s, c) => s + c.outpatients, 0);
    assert.ok(counted < d.national.outpatients);
});

test('files for different months fail', async () => {
    const shifted = files.IPDCNational01_2026.replaceAll('29/10/2026', '30/10/2026');
    await assert.rejects(run({ IPDCNational01_2026: shifted }), /different days/);
});
