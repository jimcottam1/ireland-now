// Met Éireann station observations. The API answers an unknown station with Dublin Airport's data,
// so the layer must check names; and each run's readings build up a week of history.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture, mockHttp, loadLayer } = require('./helpers');

const sample = JSON.parse(fixture('met-obs-athenry.json'));
const NAMES = {
    athenry: 'Athenry', ballyhaise: 'Ballyhaise', belmullet: 'Belmullet', casement: 'Casement', claremorris: 'Claremorris', cork: 'Cork',
    dublinairport: 'Dublin Airport', dunsany: 'Dunsany', finner: 'Finner', gurteen: 'Gurteen', 'johnstown-castle': 'Johnstown Castle',
    knock: 'Knock', 'mace-head': 'Mace Head', 'malin-head': 'Malin Head', 'markree-castle': 'Markree Castle', 'moore-park': 'Moore Park',
    mullingar: 'Mullingar', 'oak-park': 'Oak Park', 'phoenix-park': 'Phoenix Park', 'roches-point': "Roche's Point", shannon: 'Shannon',
    'sherkin-island': 'Sherkin Island', valentia: 'Valentia'
};
const slugOf = url => url.match(/observations\/([^/]+)\/today/)[1];
// The saved reports are restamped with today's date so they always fall inside the 7-day history window
const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/Dublin' }).replace(/\//g, '-');   // dd-mm-yyyy
const rowsFor = name => sample.map(r => ({ ...r, name, date: today }));

test('uses each station\'s own readings and the latest report of the day', async () => {
    mockHttp([[/prodapi\.met\.ie/, url => rowsFor(NAMES[slugOf(url)])]]);
    const d = await loadLayer('observations').fetchObservations();
    assert.equal(d.stations.length, Object.keys(NAMES).length);
    const latest = sample.map(r => r.reportTime).sort().pop();
    for (const s of d.stations) assert.equal(s.time, latest, `${s.name} should show the latest report`);
    assert.ok(d.sourceTime, 'source time is the newest report');

    const history = JSON.parse(fs.readFileSync(path.join(process.env.STATE_DIR, 'observation-history.json'), 'utf8'));
    assert.equal(history.athenry.length, new Set(sample.map(r => r.reportTime)).size, 'one history row per hourly report');
    assert.deepEqual(d.files['observations/history.json'], history, 'history is published for the trend charts');
});

test('ignores the Dublin Airport fallback the API gives for a station it doesn\'t know', async () => {
    // Every station but Athenry answers with Dublin Airport's data, as the API does for an unknown slug
    mockHttp([[/prodapi\.met\.ie/, url => rowsFor(slugOf(url) === 'athenry' ? 'Athenry' : 'Dublin Airport')]]);
    await assert.rejects(loadLayer('observations').fetchObservations(), /Only 2 stations/);
});
