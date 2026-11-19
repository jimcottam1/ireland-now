// National Monuments Service "Monuments to visit": the whole CSV as published (saved 19 November 2026, 100 sites).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { ROI_IDS } = require('../scripts/lib/geo');

const raw = String(fixture('nms-monuments-to-visit.csv'));

async function run(body = raw) {
    mockHttp([[/heritagedata\.maps\.arcgis\.com/, body]]);
    return loadLayer('heritage').fetchHeritage();
}

test('reads every site with its county, place and a short history', async () => {
    const d = await run();
    assert.equal(d.sites.length, 100);
    for (const s of d.sites) {
        assert.ok(ROI_IDS.includes(s.county), `${s.name} has county ${s.county}`);
        assert.ok(s.about.length > 40 && s.about.length <= 261, `${s.name} history is ${s.about.length} characters`);
        assert.doesNotMatch(s.name, /County/);
    }
    const corcomroe = d.sites.find(s => s.name === 'Corcomroe Abbey');
    assert.equal(corcomroe.county, 'clare');
    assert.equal(corcomroe.kind, 'Religious house (Cistercian monks)');
    assert.match(corcomroe.url, /^https:\/\/www\.archaeology\.ie\//);
    assert.equal(Object.values(d.counties).reduce((a, b) => a + b, 0), 100);
});

test('histories are cut at the end of a sentence, never after "St." or "Co."', async () => {
    const d = await run();
    for (const s of d.sites) {
        assert.doesNotMatch(s.about, /\b(St|Co|c)\.$/, `${s.name}: "${s.about.slice(-40)}"`);
        assert.match(s.about, /[.!?…)"']$/, `${s.name} ends mid-sentence: "${s.about.slice(-40)}"`);
    }
    assert.match(d.sites.find(s => s.name === 'Ennis Friary').about, /limestone\.$/);
});

test('North and South Tipperary are both Tipperary', async () => {
    const d = await run();
    assert.ok(d.counties.tipperary >= 2);
});

test('a short or changed file fails, so the last good copy is kept', async () => {
    const lines = raw.split('\n');
    await assert.rejects(run(lines.slice(0, 20).join('\n')), /only \d+ sites/);
    await assert.rejects(run(raw.replace('MONUMENT_CLASS', 'CLASS')), /columns changed/);
    await assert.rejects(run(raw.replace('53.126913999999999', '13.1269')), /not in Ireland/);
});

test('links to other sites are dropped', async () => {
    const d = await run(raw.replace('https://www.archaeology.ie/monument-of-the-month/archive/corcomroe-abbey-co-clare', 'https://example.com/x'));
    assert.equal(d.sites.find(s => s.name === 'Corcomroe Abbey').url, null);
});
