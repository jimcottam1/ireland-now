// Logainm, the Placenames Database of Ireland: every townland, town, civil parish, barony and island,
// with official Irish and English names. Needs a free API key (LOGAINM_API_KEY).
//
// The site is static, so the key can't be used from the browser: names are collected here (monthly,
// since they rarely change) and published as one file per county plus a small national search list.
const { countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'Logainm, the Placenames Database of Ireland',
    url: 'https://www.logainm.ie/',
    licence: 'CC BY 4.0'
};

const API = 'https://www.logainm.ie/api/v1.0/';

// Logainm's own ids for the 26 counties
const COUNTY_PLACE_IDS = [
    100002, 100003, 100004, 100005, 100006, 100007, 100008, 100009, 100010, 100013, 100015, 100016, 100017,
    100018, 100019, 100020, 100021, 100022, 100023, 100024, 100025, 100026, 100027, 100028, 100029, 100031
];

// Categories kept: townland, town, suburb, civil parish, barony, island
const KEEP = new Set(['BF', 'B', 'SRB', 'PAR', 'BAR', 'OIL']);
const SEARCHABLE = new Set(['B', 'SRB', 'PAR', 'BAR', 'OIL']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(key, placeId, n) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`${API}?PlaceID=${placeId}&PerPage=1000&Page=${n}`, {
                headers: { 'X-Api-Key': key, Accept: 'application/json', 'User-Agent': 'IrelandNow/1.0' },
                signal: AbortSignal.timeout(90000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} from Logainm`);
            return await res.json();
        } catch (error) {
            if (attempt === 2 || /HTTP 4\d\d/.test(error.message)) throw error;
            await sleep(5000 * (attempt + 1));
        }
    }
}

const name = (record, lang) => record.placenames?.find(p => p.language === lang)?.wording || '';

async function fetchPlacenames() {
    const key = process.env.LOGAINM_API_KEY;
    if (!key) throw new Error('LOGAINM_API_KEY is not set');

    const files = {};
    const counties = {};
    const search = [];

    for (const placeId of COUNTY_PLACE_IDS) {
        const places = [];
        let countyId = null;
        for (let n = 1, pages = 1; n <= pages; n++) {
            const data = await page(key, placeId, n);
            pages = data.totalPages || 1;
            for (const r of data.results || []) {
                const cat = r.categories?.[0]?.id;
                const coords = r.geography?.coordinates?.[0];
                if (!KEEP.has(cat) || !coords) continue;
                const county = r.includedIn?.find(x => x.category?.id === 'CON');
                const parish = r.includedIn?.find(x => x.category?.id === 'PAR');
                countyId = countyId || countyFromName(county?.nameEN);
                const lat = Number(coords.latitude.toFixed(5));
                const lon = Number(coords.longitude.toFixed(5));
                // Compact rows: [id, category, English, Irish, lat, lon, parish (en), parish (ga)]
                places.push([r.id, cat, name(r, 'en'), name(r, 'ga'), lat, lon, parish?.nameEN || '', parish?.nameGA || '']);
                if (SEARCHABLE.has(cat)) search.push([r.id, cat, name(r, 'en'), name(r, 'ga'), lat, lon, null]);
            }
            await sleep(400); // be gentle with a free service
        }
        if (!countyId) continue;
        search.forEach(row => { if (row[6] === null) row[6] = countyId; });
        files[`places/${countyId}.json`] = places;
        const count = cat => places.filter(p => p[1] === cat).length;
        counties[countyId] = { townlands: count('BF'), towns: count('B'), parishes: count('PAR'), baronies: count('BAR'), islands: count('OIL') };
        console.log(`   Logainm ${countyId}: ${places.length} places`);
    }

    search.sort((a, b) => a[2].localeCompare(b[2]));
    return { updatedAt: new Date().toISOString(), source: SOURCE, counties, search, files };
}

module.exports = { fetchPlacenames };
