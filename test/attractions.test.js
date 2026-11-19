// Fáilte Ireland attractions: the real CSV (saved 19 November 2026), cut to every other attraction plus 40
// restaurants, shops and tours, with the phone, address and photo columns emptied to keep it small.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

// Three real rows added in full, so the cases they show are always in the sample
const raw = String(fixture('failte-attractions.csv')) + [
    '',
    '"Achill Experience Aquarium & Visitor Centre","https://www.achillexperience.ie","","53.9640","-10.0011","","Mayo","","Activity Experience Attraction Zoos and Aquarium Museums and Attraction Nature and Wildlife Food Shops Shopping"',
    '"Aerfort Réigiúnach Chonamara (Connemara Regional Airport)","http://www.aerarannislands.ie","","53.2304","-9.4678","","Galway","","Activity,Experience,Transport,Attraction,Embarkation Point,Coach,Road"',
    '"Abbeyderg Abbey and Graveyard","","","53.6633","-7.8106","","Longford","","Activity,Experience,Attraction,Historic Houses and Castle,Church Abbey,Monastery,Churches, Abbeys and Monastery,Ruins"'
].join('\r\n');

async function run(body = raw) {
    mockHttp([[/failteireland\.azure-api\.net/, body]]);
    return loadLayer('attractions').fetchAttractions();
}

test('keeps attractions only, each in a county and sorted into a kind', async () => {
    const d = await run();
    assert.ok(d.attractions.length > 700 && d.attractions.length <= 840, `${d.attractions.length} attractions`);
    for (const a of d.attractions) {
        assert.ok(ROI_IDS.includes(a.county), `${a.name} has county ${a.county}`);
        assert.ok(['history', 'museum', 'nature', 'other'].includes(a.kind));
        if (a.url) assert.match(a.url, /^https:\/\//);
    }
    assert.ok(!d.attractions.some(a => a.name === 'Hungry Boba Pizzeria'), 'restaurants are left out');
    assert.ok(!d.attractions.some(a => /Airport|Aerfort/.test(a.name)), 'airports are left out');
    const counted = Object.values(d.counties).reduce((s, c) => s + c.total, 0);
    assert.equal(counted, d.attractions.length);
});

test('kinds come from the tags whether they are written with commas or spaces', async () => {
    const d = await run();
    const kinds = d.attractions.reduce((acc, a) => (acc[a.kind] = (acc[a.kind] || 0) + 1, acc), {});
    for (const k of ['history', 'museum', 'nature', 'other']) assert.ok(kinds[k] > 20, `${k}: ${kinds[k]}`);
    assert.equal(d.attractions.find(a => a.name.startsWith('Achill Experience')).kind, 'museum');   // spaces
    assert.equal(d.attractions.find(a => a.name === 'Abbeyderg Abbey and Graveyard').kind, 'history');   // commas
});

test('a short or changed file fails, so the last good copy is kept', async () => {
    await assert.rejects(run(raw.split(/\r?\n/).slice(0, 300).join('\n')), /only \d+ in the file/);
    await assert.rejects(run(raw.replace('"Tags"', '"Labels"')), /columns changed/);
});
