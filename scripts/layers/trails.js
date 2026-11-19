// Sport Ireland's National Trails Register: walking trails, long-distance ways, greenways, cycling and
// paddling trails across the island (CC BY 4.0, on data.gov.ie as national-trails-register).
// Each trail is a line; the map shows a dot where its line starts.
const { getJson } = require('../lib/http');
const { countyAt, COUNTY_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'Sport Ireland National Trails Register',
    url: 'https://data.gov.ie/dataset/national-trails-register',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const QUERY = 'https://services-eu1.arcgis.com/z1y55jruXrgzzpdi/arcgis/rest/services/NTR_ITM_view/FeatureServer/0/query';
const PAGE = 1000;
const MAX_PAGES = 5;
const MIN_TRAILS = 1000;   // about 1,350 are listed

// The register's trail types, in the words shown on the page, and the group each is coloured by
const TYPES = {
    'Walking Trail': ['Walking trail', 'walk'],
    'Long Distance Waymarked Way': ['Long-distance way', 'walk'],
    'Pilgrim Path': ['Pilgrim path', 'walk'],
    'Mountain Access Trail': ['Mountain access route', 'walk'],
    'Greenway': ['Greenway', 'cycle'],
    'Road Cycling Trail': ['Cycle route', 'cycle'],
    'Off Road Cycling Trail': ['Off-road cycle trail', 'cycle'],
    'Mountain Biking Trail': ['Mountain bike trail', 'cycle'],
    'Paddling Trail': ['Paddling trail', 'water'],
    'Snorkelling Trail': ['Snorkelling trail', 'water'],
    'Horse Riding Trail': ['Horse riding trail', 'other']
};

const pageUrl = offset => `${QUERY}?where=1%3D1&outFields=Trail_ID,Trail_Name,Trail_Type,Shape__Length`
    + `&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${PAGE}`
    + '&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=4&f=json';

/** A trail's pieces as [lat, lon] lists, rounded to about 10 m (the register's lines are simplified to ~100 m). */
const routeOf = paths => paths
    .map(piece => piece.map(([lon, lat]) => [Number(lat.toFixed(4)), Number(lon.toFixed(4))]))
    .filter(piece => piece.length >= 2 || paths.length === 1);

async function fetchTrails() {
    const features = [];
    for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error(`Trails: still more after ${MAX_PAGES} pages`);
        const answer = await getJson(pageUrl(page * PAGE));
        if (answer.error) throw new Error(`Trails: ${answer.error.message || 'the register answered with an error'}`);
        if (!Array.isArray(answer.features)) throw new Error('Trails: answer not recognised');
        features.push(...answer.features);
        if (!answer.exceededTransferLimit) break;
    }

    const trails = [];
    const unknownTypes = new Set();
    for (const f of features) {
        const a = f.attributes || {};
        const name = String(a.Trail_Name || '').trim();
        const start = f.geometry?.paths?.[0]?.[0];
        if (!name || !start) continue;   // a few unnamed fragments
        const [lon, lat] = start;
        if (!(lat > 51 && lat < 55.5 && lon > -10.8 && lon < -5.3)) throw new Error(`Trails: ${name} starts outside Ireland (${lat}, ${lon})`);
        const county = countyAt(lon, lat);
        if (!COUNTY_IDS.includes(county)) continue;   // offshore paddling and snorkelling trails
        const type = TYPES[a.Trail_Type];
        if (a.Trail_Type && !type) unknownTypes.add(a.Trail_Type);
        trails.push({
            id: a.Trail_ID ?? null,
            name,
            type: type?.[0] || 'Trail',
            group: type?.[1] || 'other',
            km: a.Shape__Length > 0 ? Number((a.Shape__Length / 1000).toFixed(1)) : null,
            county,
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
            line: routeOf(f.geometry.paths)
        });
    }
    for (const t of unknownTypes) console.warn(`   Trails: new trail type "${t}" shown as "Trail"`);
    if (trails.length < MIN_TRAILS) throw new Error(`Trails: only ${trails.length} trails in the register`);

    const counties = {};
    for (const t of trails) {
        const c = (counties[t.county] ||= { total: 0, walk: 0, cycle: 0, water: 0, other: 0, km: 0 });
        c.total++;
        c[t.group]++;
        c.km += t.km || 0;
    }
    for (const c of Object.values(counties)) c.km = Math.round(c.km);

    trails.sort((a, b) => a.name.localeCompare(b.name));
    // Routes go in their own file, loaded only when Trails is switched on: one entry per trail, in the
    // same order as `trails`, each a list of pieces of [lat, lon] points
    const lines = trails.map(t => t.line);
    for (const t of trails) delete t.line;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        allIsland: true,
        trails,
        counties,
        files: { 'trail-lines.json': lines }
    };
}

module.exports = { fetchTrails };
