// Weather warnings: Met Éireann (JSON) and the Met Office's Northern Ireland feed (RSS).
// The Met Office sample follows the wording its RSS items normally use; none were live when this was written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockHttp, loadLayer } = require('./helpers');

const inHours = h => new Date(Date.now() + h * 3600000).toISOString();

const MET_EIREANN = [
    { capId: 'a', level: 'Orange', type: 'Wind', headline: 'Wind warning for Cork and Kerry', description: '<p>Southwest gales.</p>',
        onset: inHours(-1), expiry: inHours(6), regions: ['EI04', 'EI11'] },
    { capId: 'b', level: 'Yellow', type: 'Rain', headline: 'Rain warning for west Cork', description: '<p>Heavy rain.</p>',
        onset: inHours(1), expiry: inHours(12), regions: ['EI041'] },   // sub-region code of Cork
    { capId: 'old', level: 'Red', type: 'Wind', headline: 'Expired', description: '', onset: inHours(-30), expiry: inHours(-2), regions: ['EI07'] }
];

const MET_OFFICE_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Yellow warning of rain affecting Northern Ireland</title>
<link>https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings#?id=abc</link>
<description>Yellow warning of rain affecting Northern Ireland: Antrim, Down valid from 0600 Mon 02 Nov to 1800 Mon 02 Nov</description>
<pubDate>Sat, 31 Oct 2026 10:00:51 GMT</pubDate><guid isPermaLink="false">abc</guid></item>
<item><title>Amber warning of wind affecting Northern Ireland</title>
<description><![CDATA[Amber warning of wind affecting Northern Ireland valid from 2100 Sat 31 Oct to 0900 Sun 01 Nov]]></description></item>
</channel></rss>`;

test('Met Office items: level, named counties (or all six) and UK times', () => {
    const { parseMetOffice } = loadLayer('warnings');
    const [rain, wind] = parseMetOffice(MET_OFFICE_RSS);
    assert.equal(rain.level, 'yellow');
    assert.deepEqual(rain.counties.sort(), ['antrim', 'down']);
    // The feed gives no year, so the layer picks the nearest one; check the day and time (GMT in November)
    assert.match(rain.onset, /^\d{4}-11-02T06:00:00\.000Z$/);
    assert.match(rain.expiry, /^\d{4}-11-02T18:00:00\.000Z$/);
    assert.equal(wind.level, 'orange', 'Met Office amber shows as orange');
    assert.equal(wind.counties.length, 6, 'no county named means all six');
    assert.equal(wind.issuer, 'Met Office');
});

test('Met Éireann warnings map to counties, and expired ones are dropped', async () => {
    mockHttp([[/met\.ie/, MET_EIREANN], [/metoffice/, '<rss><channel></channel></rss>']]);
    const d = await loadLayer('warnings').fetchWarnings();
    assert.equal(d.warnings.length, 2);
    assert.deepEqual(d.warnings[0].counties.sort(), ['cork', 'kerry']);
    assert.deepEqual(d.warnings[1].counties, ['cork'], 'sub-region codes count as their county');
    assert.equal(d.counties.cork.level, 'orange', 'a county shows its highest level');
    assert.equal(d.counties.dublin, undefined);
});

test('if the Met Office feed fails, Met Éireann warnings still publish', async () => {
    mockHttp([[/met\.ie/, MET_EIREANN], [/metoffice/, () => { throw new Error('HTTP 503'); }]]);
    const d = await loadLayer('warnings').fetchWarnings();
    assert.equal(d.warnings.length, 2);
});
