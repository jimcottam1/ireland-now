// National Monuments Service "Monuments to visit": about a hundred state-cared and public historic sites
// (abbeys, castles, tombs, forts) with a short history of each. A fixed list, changed rarely.
// Published on data.gov.ie (national-monuments-service-monuments-to-visit) under CC BY 4.0.
const { getText } = require('../lib/http');
const { csvObjects } = require('../lib/csv');
const { countyFromName, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'National Monuments Service, Monuments to visit',
    url: 'https://data.gov.ie/dataset/national-monuments-service-monuments-to-visit',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const CSV = 'https://heritagedata.maps.arcgis.com/sharing/rest/content/items/c8a106fb003642159ebcfa5f19d3f9bc/data';
const COLUMNS = ['NAME', 'MonumentsToVisit_INFO', 'external_link', 'SMRS', 'COUNTY', 'MONUMENT_CLASS', 'LATITUDE', 'LONGITUDE'];
const MIN_SITES = 60;   // the list has 100; far fewer means the file was cut short
const SUMMARY = 260;    // characters of the history to show

// Links only to the sites the list itself uses
const LINK = /^https:\/\/(www\.)?(heritageireland\.ie|archaeology\.ie|discoverireland\.ie|opw\.ie|gov\.ie)\//i;

const ABBREVIATIONS = /^(st|sts|co|c|ca|fr|mt|no|nos|dr|rev|ft|approx|[a-z])$/i;

/** The first sentence or two of a history, cut at a sentence end where possible. */
function summary(text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= SUMMARY) return t;
    const cut = t.slice(0, SUMMARY);
    // The last full stop that ends a sentence, not "St. Patrick", "Co. Clare" or "c. 1200"
    let end = -1;
    for (const m of cut.matchAll(/(\S+)\. (?=\S)/g)) {
        if (!ABBREVIATIONS.test(m[1])) end = m.index + m[0].length - 1;
    }
    return end > 80 ? cut.slice(0, end) : cut.replace(/\s+\S*$/, '') + '…';
}

/** "Castle - Anglo-Norman masonry castle" -> "Anglo-Norman masonry castle"; "Religious house - Cistercian monks" kept whole */
function kind(text) {
    const [group, detail] = String(text).split(' - ').map(s => s.trim());
    if (!detail) return group;
    return /^(castle|megalithic tomb|house|cross)$/i.test(group) ? detail.charAt(0).toUpperCase() + detail.slice(1) : `${group} (${detail})`;
}

async function fetchHeritage() {
    const rows = csvObjects(await getText(CSV), COLUMNS);
    const sites = rows.map(r => {
        const lat = Number(r.LATITUDE);
        const lon = Number(r.LONGITUDE);
        if (!(lat > 51 && lat < 55.5 && lon > -10.8 && lon < -5.3)) throw new Error(`Heritage: ${r.NAME} is not in Ireland (${r.LATITUDE}, ${r.LONGITUDE})`);
        const county = countyFromName(r.COUNTY);
        if (!ROI_IDS.includes(county)) throw new Error(`Heritage: "${r.COUNTY}" for ${r.NAME} is not a county`);
        return {
            name: r.NAME.replace(/,\s*(County|Co\.)\s+[\w\s]+$/i, '').trim(),
            county,
            kind: kind(r.MONUMENT_CLASS),
            about: summary(r.MonumentsToVisit_INFO),
            url: LINK.test(r.external_link) ? r.external_link : null,
            smr: r.SMRS.replace(/-+$/, ''),
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5))
        };
    });
    if (sites.length < MIN_SITES) throw new Error(`Heritage: only ${sites.length} sites in the list`);

    const counties = {};
    for (const s of sites) counties[s.county] = (counties[s.county] || 0) + 1;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sites: sites.sort((a, b) => a.name.localeCompare(b.name)),
        counties
    };
}

module.exports = { fetchHeritage };
