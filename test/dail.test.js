// Dáil: the latest sitting day's business and recent bills, from trimmed copies of the real Oireachtas API answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const json = name => JSON.parse(fixture(name).toString());
async function run(t, { debates = json('oireachtas-debates.json'), bills = json('oireachtas-bills.json') } = {}, seen = []) {
    freezeClock(t, '2026-11-01T21:50:00Z');
    mockHttp([
        [/api\.oireachtas\.ie\/v1\/debates/, url => { seen.push(url); return debates; }],
        [/api\.oireachtas\.ie\/v1\/legislation/, url => { seen.push(url); return bills; }]
    ]);
    return loadLayer('dail').fetchDail();
}

test('asks for the Dáil (not the Seanad or committees) and bills from the last 30 days', async t => {
    const seen = [];
    await run(t, undefined, seen);
    const debates = new URL(seen.find(u => /debates/.test(u))).searchParams;
    assert.equal(debates.get('chamber'), 'dail');
    assert.equal(debates.get('chamber_type'), 'house');
    assert.equal(debates.get('date_start'), '2026-10-02');
    const bills = new URL(seen.find(u => /legislation/.test(u))).searchParams;
    assert.equal(bills.get('date_start'), '2026-10-02');
    assert.equal(bills.get('bill_status'), 'Current,Enacted');
});

test('the last sitting is the newest day, however the answer is ordered', async t => {
    const debates = json('oireachtas-debates.json');
    debates.results.reverse();      // oldest first
    const d = await run(t, { debates });
    assert.equal(d.lastSitting.date, '2026-10-22');
    assert.equal(d.lastSitting.url, 'https://www.oireachtas.ie/en/debates/debate/dail/2026-10-22/');
    assert.equal(d.sittingDays, 4);
});

test('topics are the real business: no bilingual procedural headings, no repeats, at most 15', async t => {
    const d = await run(t);
    assert.deepEqual(d.lastSitting.topics, [
        'Semi-State Bodies', 'Public Expenditure Policy', 'Budget 2027', 'Public Sector Pay', 'Civil Service', 'Office of Public Works',
        'Flood Relief Schemes', 'Artificial Intelligence', 'National Parks', 'Special Educational Needs', 'Education Schemes',
        'Education Policy', 'School Attendance', 'School Staff', 'Youth Services'
    ]);
    assert.ok(d.lastSitting.topics.every(x => !/ - /.test(x)));
    // Later items of the day exist but are cut by the limit of 15
    const all = json('oireachtas-debates.json').results[0].debateRecord.debateSections.map(s => s.debateSection.showAs);
    assert.ok(all.includes('Spiking Offences Bill 2026: First Stage'));
    assert.ok(!d.lastSitting.topics.includes('Spiking Offences Bill 2026: First Stage'));
});

test('other procedural headings are dropped too, and an empty heading is ignored', async t => {
    const debates = json('oireachtas-debates.json');
    const sections = ['Message from Select Committee', 'Business of Dáil', 'Estimates for Public Services 2026', '', null, 'Housing Policy', 'Estimates for Public Services 2026: Vote 5']
        .map(showAs => ({ debateSection: { showAs } }));
    debates.results[0].debateRecord.debateSections = sections;
    const d = await run(t, { debates });
    assert.deepEqual(d.lastSitting.topics, ['Housing Policy']);
});

test('no sitting in the last 30 days (the recess) gives no last sitting rather than an error', async t => {
    const d = await run(t, { debates: { head: {}, results: [] } });
    assert.equal(d.lastSitting, null);
    assert.equal(d.sittingDays, 0);
    assert.equal(d.bills.length, 12);
});

test('bills: most recent stage first, twelve at most, with sponsor, house and link', async t => {
    const d = await run(t);
    assert.deepEqual(d.bills.map(b => b.url.split('/').slice(-3, -1).join('/')), [
        '2026/52', '2026/36', '2026/95', '2026/101', '2026/102', '2026/99', '2026/100', '2026/63', '2026/98', '2026/97', '2026/96', '2026/54'
    ]);
    const dates = d.bills.map(b => b.stageDate);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.ok(!d.bills.some(b => b.title.startsWith('Local Government (Control of Horse-Drawn')), 'the two oldest are cut');

    const spiking = d.bills.find(b => b.title === 'Spiking Offences Bill 2026');
    assert.deepEqual(spiking, {
        title: 'Spiking Offences Bill 2026', status: 'Current', source: 'Private Member', stage: 'Second Stage', stageDate: '2026-10-22',
        house: '34th Dáil', sponsor: 'Mark Ward', url: 'https://www.oireachtas.ie/en/bills/bill/2026/102/'
    });
    // A government bill is sponsored by a minister, not a named TD
    assert.equal(d.bills.find(b => /Short-Term Lettings/.test(b.title)).sponsor, 'Minister for Enterprise, Tourism and Employment');
    // An enacted bill has no house on its latest stage
    const enacted = d.bills.find(b => b.status === 'Enacted');
    assert.equal(enacted.house, null);
    assert.ok(enacted.stage);
});

test('bills with no title are dropped, a missing sponsor or stage is null, and the first sponsor stands in if none is primary', async t => {
    const bills = { head: {}, results: [
        { bill: { billNo: '1', billYear: '2026', shortTitleEn: '', status: 'Current' } },
        { bill: { billNo: '2', billYear: '2026', shortTitleEn: 'Bare Bill', status: 'Current', source: 'Government' } },
        { bill: { billNo: '3', billYear: '2026', shortTitleEn: 'Backbench Bill', status: 'Current', sponsors: [
            { sponsor: { by: { showAs: 'First Member' }, isPrimary: false } }, { sponsor: { by: { showAs: 'Second Member' }, isPrimary: false } }] } }
    ] };
    const d = await run(t, { bills });
    assert.equal(d.bills.length, 2);
    const bare = d.bills.find(b => b.title === 'Bare Bill');
    assert.deepEqual([bare.stage, bare.stageDate, bare.house, bare.sponsor], [null, null, null, null]);
    assert.equal(d.bills.find(b => b.title === 'Backbench Bill').sponsor, 'First Member');
});

test('both sources are credited, and an unrecognised response throws', async t => {
    const d = await run(t);
    assert.ok(d.source.name.includes('Oireachtas'));
    assert.ok(d.updatedAt);
    await assert.rejects(run(t, { debates: '<html>Gateway Timeout</html>' }));
    await assert.rejects(run(t, { bills: '<html>Gateway Timeout</html>' }));
});
