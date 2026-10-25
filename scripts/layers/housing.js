// Property Price Register: median sale price by county over the last 12 months, and the change on
// the 12 months before. Uses full-market-price sales only.
const AdmZip = require('adm-zip');
const { getBuffer } = require('../lib/http');
const { countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'Property Price Register',
    url: 'https://www.propertypriceregister.ie/',
    licence: 'PSI General Licence'
};

const ZIP = 'https://www.propertypriceregister.ie/website/npsra/ppr/npsra-ppr.nsf/Downloads/PPR-ALL.zip/$FILE/PPR-ALL.zip';

/** Minimal CSV line parser that handles quoted fields with commas. */
function parseLine(line) {
    const out = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { out.push(field); field = ''; }
        else field += ch;
    }
    out.push(field);
    return out;
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function fetchHousing() {
    const zip = new AdmZip(await getBuffer(ZIP, { timeoutMs: 120000 }));
    const entry = zip.getEntries().find(e => /\.csv$/i.test(e.entryName));
    // The register is published in Windows-1252 (the € sign is byte 0x80), which latin1 reads well enough here
    const lines = zip.readFile(entry).toString('latin1').split(/\r?\n/);

    const header = parseLine(lines[0]).map(h => h.toLowerCase());
    const col = name => header.findIndex(h => h.includes(name));
    const iDate = col('date of sale');
    const iCounty = col('county');
    const iPrice = col('price');
    const iNotFull = col('not full market');

    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    const recent = {};
    const previous = {};
    let latestSale = null;
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const row = parseLine(lines[i]);
        if (/yes/i.test(row[iNotFull] || '')) continue;
        const [d, m, y] = (row[iDate] || '').split('/').map(Number);
        if (!y) continue;
        const date = new Date(y, m - 1, d);
        if (date < twoYearsAgo || date > now) continue;
        const price = parseFloat((row[iPrice] || '').replace(/[^0-9.]/g, ''));
        const county = countyFromName(row[iCounty]);
        if (!county || !Number.isFinite(price) || price < 10000) continue;
        const bucket = date >= yearAgo ? recent : previous;
        (bucket[county] = bucket[county] || []).push(price);
        if (!latestSale || date > latestSale) latestSale = date;
    }

    const counties = {};
    const all = [];
    const allPrev = [];
    for (const id of Object.keys(recent)) {
        const med = median(recent[id]);
        const prev = median(previous[id] || []);
        all.push(...recent[id]);
        allPrev.push(...(previous[id] || []));
        counties[id] = {
            median: med,
            sales: recent[id].length,
            change: prev ? Number((100 * (med - prev) / prev).toFixed(1)) : null
        };
    }
    const natMed = median(all);
    const natPrev = median(allPrev);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        period: { from: yearAgo.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
        latestSale: latestSale && latestSale.toISOString().slice(0, 10),
        national: { median: natMed, sales: all.length, change: natPrev ? Number((100 * (natMed - natPrev) / natPrev).toFixed(1)) : null },
        counties
    };
}

module.exports = { fetchHousing };
