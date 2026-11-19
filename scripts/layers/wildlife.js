// Wildlife sightings in the last 30 days, from GBIF (the Global Biodiversity Information Facility), which
// gathers Ireland's records from iNaturalist, the National Biodiversity Data Centre and others. Only records
// under CC0, CC BY or CC BY-NC are used (Ireland Now is non-commercial), with credit to GBIF and each dataset.
// GBIF already blurs sensitive species; positions here are also rounded to about 1 km.
const { getJson } = require('../lib/http');
const { countyAt, COUNTY_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'GBIF.org occurrence data (iNaturalist, National Biodiversity Data Centre and others)',
    url: 'https://www.gbif.org/occurrence/search?country=IE',
    licence: 'CC0, CC BY 4.0 and CC BY-NC 4.0 records',
    licenceUrl: 'https://www.gbif.org/terms'
};

const API = 'https://api.gbif.org/v1/occurrence/search';
const DAYS = 30;
const PAGE = 300;
const MAX_PAGES = 15;          // 4,500 records; a month usually has about 1,000
const MIN_RECORDS = 100;
const LICENCES = /creativecommons\.org\/(publicdomain\/zero|licenses\/by\/|licenses\/by-nc\/)/i;

// Groups for the dot colours, checked in order: [group, test on the record]
const GROUPS = [
    ['birds', r => r.class === 'Aves'],
    ['mammals', r => r.class === 'Mammalia'],
    ['insects', r => r.class === 'Insecta' || r.class === 'Arachnida'],
    ['plants', r => r.kingdom === 'Plantae'],
    ['fungi', r => r.kingdom === 'Fungi'],
    ['sea life', r => ['Malacostraca', 'Bivalvia', 'Anthozoa', 'Ascidiacea', 'Actinopterygii', 'Elasmobranchii', 'Phaeophyceae', 'Florideophyceae', 'Echinoidea', 'Asteroidea'].includes(r.class)]
];
const groupOf = r => GROUPS.find(([, test]) => test(r))?.[0] || 'other';

const isoDay = d => d.toISOString().slice(0, 10);

async function fetchWildlife() {
    const to = new Date();
    const from = new Date(to.getTime() - DAYS * 86400000);
    const base = `${API}?country=IE&eventDate=${isoDay(from)},${isoDay(to)}&hasCoordinate=true&hasGeospatialIssue=false`
        + `&occurrenceStatus=PRESENT&limit=${PAGE}`;

    const records = [];
    for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) break;   // a very busy month: the newest-indexed 4,500 are enough
        const answer = await getJson(`${base}&offset=${page * PAGE}`);
        if (!Array.isArray(answer?.results)) throw new Error('Wildlife: answer not recognised');
        records.push(...answer.results);
        if (answer.endOfRecords || !answer.results.length) break;
    }

    const datasets = {};
    const seen = new Set();
    const points = [];
    for (const r of records) {
        if (!LICENCES.test(r.license || '')) continue;
        if (!Number.isFinite(r.decimalLatitude) || !Number.isFinite(r.decimalLongitude)) continue;
        if (r.coordinateUncertaintyInMeters > 5000) continue;   // too vague to place in a county
        const name = r.species || r.scientificName;
        if (!name) continue;
        const lat = Number(r.decimalLatitude.toFixed(2));
        const lon = Number(r.decimalLongitude.toFixed(2));
        const day = String(r.eventDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        // One dot per species, place and day (people often log the same bird several times)
        const key = `${name}|${lat}|${lon}|${day}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const county = countyAt(lon, lat);
        if (!COUNTY_IDS.includes(county)) continue;   // at sea
        const dataset = r.datasetName || r.institutionCode || 'Other datasets';
        datasets[dataset] = (datasets[dataset] || 0) + 1;
        points.push([groupOf(r), r.vernacularName || null, name, day, county, lat, lon]);
    }
    if (points.length < MIN_RECORDS) throw new Error(`Wildlife: only ${points.length} usable sightings in ${DAYS} days`);

    const counties = {};
    for (const [group, common, name, , county] of points) {
        const c = (counties[county] ||= { sightings: 0, species: {}, groups: {} });
        c.sightings++;
        c.groups[group] = (c.groups[group] || 0) + 1;
        const label = common ? `${common} (${name})` : name;
        c.species[label] = (c.species[label] || 0) + 1;
    }
    for (const c of Object.values(counties)) {
        c.speciesCount = Object.keys(c.species).length;
        c.top = Object.entries(c.species).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
        delete c.species;
    }

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        allIsland: true,
        days: DAYS,
        newest: points.map(p => p[3]).sort().pop(),
        datasets: Object.entries(datasets).sort((a, b) => b[1] - a[1]).slice(0, 6),
        counties,
        files: { 'wildlife-points.json': points }
    };
}

module.exports = { fetchWildlife };
