// Fáilte Ireland visitor attractions: castles, museums, gardens, beaches and other places to visit,
// from Fáilte Ireland's open data (tourism activities and attractions, CC BY 4.0). The CSV also lists
// restaurants, shops and tour operators; only rows tagged "Attraction" are kept.
const { getText } = require('../lib/http');
const { csvObjects } = require('../lib/csv');
const { countyFromName, countyAt, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'Fáilte Ireland open data, activities and attractions',
    url: 'https://data.gov.ie/dataset/tourism-activities-and-attractions',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const CSV = 'https://failteireland.azure-api.net/opendata-api/v2/attractions/csv';
const COLUMNS = ['Name', 'Url', 'Latitude', 'Longitude', 'County', 'Tags'];
const MIN_ATTRACTIONS = 700;   // about 1,600 are listed; far fewer means the file was cut short

// Kinds, checked in this order; the tags are written with commas or spaces, so match words anywhere
const KINDS = [
    ['history', /Historic Houses|Castle|Church Abbey|Monastery|Ruins|Heritage|Archaeolog/i],
    ['museum', /Museums and Attraction|Art Gallery|Literary Ireland|Tracing Your Ancestors/i],
    ['nature', /Nature and Wildlife|Beach|Natural Landscape|Garden|Island|Park|Visitor Farm|Forest|River|Lake/i]
];
// Airports, ferry ports and coach stops are tagged as attractions too
const SKIP = /Embarkation Point/i;

const kindOf = tags => KINDS.find(([, pattern]) => pattern.test(tags))?.[0] || 'other';
const safeUrl = url => /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url.replace(/^http:/i, 'https:') : null;

async function fetchAttractions() {
    const rows = csvObjects(await getText(CSV), COLUMNS);
    const seen = new Set();
    const attractions = [];
    for (const r of rows) {
        if (!/\bAttraction\b/i.test(r.Tags) || SKIP.test(r.Tags)) continue;
        const lat = Number(r.Latitude);
        const lon = Number(r.Longitude);
        if (!(lat > 51 && lat < 55.5 && lon > -10.8 && lon < -5.3)) continue;   // a few entries have no position
        const key = `${r.Name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const county = countyFromName(r.County) || countyAt(lon, lat);
        if (!ROI_IDS.includes(county)) continue;
        attractions.push({
            name: r.Name.trim(),
            county,
            kind: kindOf(r.Tags),
            url: safeUrl(r.Url),
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5))
        });
    }
    if (attractions.length < MIN_ATTRACTIONS) throw new Error(`Attractions: only ${attractions.length} in the file`);

    const counties = {};
    for (const a of attractions) {
        const c = (counties[a.county] ||= { total: 0, history: 0, museum: 0, nature: 0, other: 0 });
        c.total++;
        c[a.kind]++;
    }

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        attractions: attractions.sort((a, b) => a.name.localeCompare(b.name)),
        counties
    };
}

module.exports = { fetchAttractions };
