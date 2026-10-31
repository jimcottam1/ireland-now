// Average pump prices in Ireland (petrol, diesel, home heating oil), from the European Commission's
// Weekly Oil Bulletin. This is the official national average each Member State reports every week;
// nobody publishes official prices by county or by station.
const AdmZip = require('adm-zip');
const { getText, getBuffer } = require('../lib/http');

const SOURCE = {
    name: 'European Commission Weekly Oil Bulletin',
    url: 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en',
    licence: 'CC BY 4.0'
};

const PAGE = 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en';

// Columns we want, by the header the bulletin uses (prices are € per 1,000 litres)
const COLUMNS = { petrol: 'IE_price_with_tax_euro95', diesel: 'IE_price_with_tax_diesel', heatingOil: 'IE_price_with_tax_heating_oil' };

const excelDate = serial => new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);

/** The history workbook's download link changes when it's re-uploaded, so find it on the bulletin page. */
async function historyUrl() {
    const html = await getText(PAGE);
    const href = html.match(/href="([^"]*Prices_History[^"]*\.xlsx[^"]*)"/i)?.[1];
    if (!href) throw new Error('Oil Bulletin history file not found on the page');
    return new URL(href.replace(/&amp;/g, '&'), PAGE).toString();
}

function readSheet(zip, sheetName) {
    const workbook = zip.readAsText('xl/workbook.xml');
    const rels = zip.readAsText('xl/_rels/workbook.xml.rels');
    const rid = workbook.match(new RegExp(`<sheet [^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`))?.[1];
    const target = rid && rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
        || rid && rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    if (!target) throw new Error(`Sheet "${sheetName}" not found`);
    const strings = [...zip.readAsText('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, ''));
    const xml = zip.readAsText(`xl/${target.replace(/^\/?xl\//, '')}`);
    return { xml, strings };
}

function cells(row, strings) {
    const out = {};
    for (const m of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>[\s\S]*?<\/f>)?(?:<v>([\s\S]*?)<\/v>)?<\/c>)/g)) {
        if (m[3] === undefined) continue;
        out[m[1]] = /t="s"/.test(m[2]) ? strings[Number(m[3])] : m[3];
    }
    return out;
}

async function fetchFuel() {
    const zip = new AdmZip(await getBuffer(await historyUrl(), { timeoutMs: 120000 }));
    const { xml, strings } = readSheet(zip, 'Prices with taxes');
    const rows = xml.match(/<row [\s\S]*?<\/row>/g) || [];

    const header = cells(rows[0], strings);
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, Object.keys(header).find(k => header[k] === name)]));
    if (!col.petrol || !col.diesel) throw new Error('Ireland columns not found in the Oil Bulletin');

    // Newest week first; dates are Excel serial numbers in column A
    const weeks = [];
    for (const row of rows.slice(1)) {
        const c = cells(row, strings);
        const serial = Number(c.A);
        if (!serial || !c[col.petrol]) continue;
        weeks.push({
            date: excelDate(serial),
            petrol: Number((Number(c[col.petrol]) / 1000).toFixed(3)),
            diesel: Number((Number(c[col.diesel]) / 1000).toFixed(3)),
            heatingOil: c[col.heatingOil] ? Number((Number(c[col.heatingOil]) / 1000).toFixed(3)) : null
        });
        if (weeks.length >= 53) break;
    }
    if (!weeks.length) throw new Error('No Irish prices in the Oil Bulletin');
    weeks.sort((a, b) => b.date.localeCompare(a.date));

    const [latest, previous] = weeks;
    const yearAgo = weeks.find(w => new Date(latest.date) - new Date(w.date) >= 364 * 86400000) || null;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        national: {
            ...latest,
            previous: previous || null,
            yearAgo,
            // Last 6 months, oldest first, for a small chart
            history: weeks.slice(0, 26).reverse().map(w => [w.date, w.petrol, w.diesel])
        }
    };
}

module.exports = { fetchFuel };
