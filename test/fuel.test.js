// EU Weekly Oil Bulletin: the link is found on a web page and the prices read from a spreadsheet.
// The real workbook is 4.5 MB, so the test builds a tiny one with the same layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { fixture, mockHttp, loadLayer } = require('./helpers');

/** Excel date serial for a YYYY-MM-DD date */
const serial = date => Math.round((Date.parse(date + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);

/** A minimal .xlsx with a "Prices with taxes" sheet: header names in shared strings, one row per week. */
function workbook(weeks, header = ['Date', 'IE_price_with_tax_euro95', 'IE_price_with_tax_diesel', 'IE_price_with_tax_heating_oil']) {
    const zip = new AdmZip();
    zip.addFile('xl/workbook.xml', Buffer.from('<workbook><sheets><sheet name="Consumption" sheetId="1" r:id="rId9"/><sheet name="Prices with taxes" sheetId="2" r:id="rId1"/></sheets></workbook>'));
    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="worksheet" Target="worksheets/sheet9.xml"/></Relationships>'));
    zip.addFile('xl/sharedStrings.xml', Buffer.from(`<sst>${header.map(h => `<si><t>${h}</t></si>`).join('')}</sst>`));
    const cols = ['A', 'B', 'C', 'D'];
    const head = `<row r="1">${header.map((_, i) => `<c r="${cols[i]}1" t="s"><v>${i}</v></c>`).join('')}</row>`;
    const rows = weeks.map(([date, ...prices], r) =>
        `<row r="${r + 2}"><c r="A${r + 2}"><v>${serial(date)}</v></c>${prices.map((p, i) => `<c r="${cols[i + 1]}${r + 2}"><v>${p}</v></c>`).join('')}</row>`);
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(`<worksheet><sheetData>${head}${rows.join('')}</sheetData></worksheet>`));
    return zip.toBuffer();
}

// Newest first, as the bulletin lists them; prices in € per 1,000 litres
const WEEKS = [
    ['2026-10-26', 1970.8, 2136.7, 1575.95],
    ['2026-10-19', 1970.8, 2136.7, 1575.95],
    ['2026-10-12', 1976.5, 2153.8, 1528.5],
    ['2025-10-27', 1728.0, 1670.0, 963.0]
];

test('finds the history workbook on the bulletin page and reads Irish prices from it', async () => {
    mockHttp([
        [/weekly-oil-bulletin_en$/, fixture('oil-bulletin-page.html')],
        [/Prices_History/, workbook(WEEKS)]
    ]);
    const { national: n } = await loadLayer('fuel').fetchFuel();
    assert.equal(n.date, '2026-10-26');
    assert.equal(n.petrol, 1.971);
    assert.equal(n.diesel, 2.137);
    assert.equal(n.heatingOil, 1.576);
    assert.equal(n.previous.date, '2026-10-19');
    assert.equal(n.yearAgo.date, '2025-10-27', 'year-ago comparison is about 52 weeks back');
    assert.equal(n.history[0][0], '2025-10-27', 'chart history runs oldest first');
    assert.equal(n.history[n.history.length - 1][0], '2026-10-26');
});

test('fails clearly if the bulletin stops publishing Irish columns', async () => {
    mockHttp([
        [/weekly-oil-bulletin_en$/, fixture('oil-bulletin-page.html')],
        [/Prices_History/, workbook(WEEKS, ['Date', 'FR_price_with_tax_euro95', 'FR_price_with_tax_diesel', 'FR_price_with_tax_heating_oil'])]
    ]);
    await assert.rejects(loadLayer('fuel').fetchFuel(), /Ireland columns not found/);
});

test('fails clearly if the history file disappears from the page', async () => {
    mockHttp([[/weekly-oil-bulletin_en$/, '<html><a href="/other.pdf">Other</a></html>']]);
    await assert.rejects(loadLayer('fuel').fetchFuel(), /history file not found/);
});
