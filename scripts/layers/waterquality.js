// EPA Water Framework Directive status of rivers and lakes, 2019–2024: each river stretch and lake is rated
// High, Good, Moderate, Poor or Bad for its ecology. CC BY 4.0, from the EPA's GeoServer (gis.epa.ie).
// Published every few years, so fetched weekly. Positions are the EPA's Irish Grid point for each water body.
const { getJson } = require('../lib/http');
const { irishGridToLatLon } = require('../lib/itm');
const { countyAt, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'EPA water quality status 2019–2024 (Water Framework Directive)',
    url: 'https://www.catchments.ie/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const PERIOD = '2019–2024';
const LAYERS = { river: 'WFD_RWBStatus_20192024', lake: 'WFD_LWBStatus_20192024' };
const MIN = { river: 1000, lake: 600 };   // 3,208 and 812 were published; far fewer means a cut-short answer
const STATUSES = ['High', 'Good', 'Moderate', 'Poor', 'Bad'];

const url = layer => 'https://gis.epa.ie/geoserver/EPA/ows?service=WFS&version=1.0.0&request=GetFeature'
    + `&typeName=EPA:${layer}&outputFormat=application/json&propertyName=European_Code,Name,Status,easting,northing`;

/** "SILVER (KILCORMAC)_050" -> "Silver (Kilcormac)"; "Glass" stays "Glass" */
function tidyName(name) {
    return String(name || '').replace(/_\d+[A-Z]?$/, '').trim().toLowerCase()
        .replace(/(^|[\s(\-'])([a-záéíóú])/g, (m, before, letter) => before + letter.toUpperCase());
}

async function fetchWaterQuality() {
    const bodies = [];
    for (const [kind, layer] of Object.entries(LAYERS)) {
        const answer = await getJson(url(layer), { timeoutMs: 120000 });
        if (!Array.isArray(answer?.features)) throw new Error(`Water quality: the ${kind} answer is not recognised`);
        const list = [];
        for (const f of answer.features) {
            const p = f.properties || {};
            if (p.Status === 'Unassigned' || p.Status == null) continue;   // a handful not yet rated
            if (!STATUSES.includes(p.Status)) throw new Error(`Water quality: unknown status "${p.Status}" for ${p.Name}`);
            if (!Number.isFinite(p.easting) || !Number.isFinite(p.northing)) throw new Error(`Water quality: ${p.Name} has no position`);
            const [lat, lon] = irishGridToLatLon(p.easting, p.northing);
            const county = countyAt(lon, lat);
            if (!ROI_IDS.includes(county)) continue;   // a few lakes sit on the border; the EPA covers the Republic
            list.push({ kind, name: tidyName(p.Name) || p.European_Code, code: p.European_Code, status: p.Status, county, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
        }
        if (list.length < MIN[kind]) throw new Error(`Water quality: only ${list.length} ${kind}s`);
        bodies.push(...list);
    }

    const blank = () => Object.fromEntries(STATUSES.map(s => [s, 0]));
    const counties = {};
    const national = { river: blank(), lake: blank() };
    for (const b of bodies) {
        const c = (counties[b.county] ||= { river: blank(), lake: blank() });
        c[b.kind][b.status]++;
        national[b.kind][b.status]++;
    }
    // Share rated Good or High: the Directive's target for every water body
    const goodShare = t => { const all = STATUSES.reduce((n, s) => n + t[s], 0); return all ? Math.round(100 * (t.High + t.Good) / all) : null; };
    for (const c of [...Object.values(counties), national]) {
        c.riverGood = goodShare(c.river);
        c.lakeGood = goodShare(c.lake);
    }

    // The 4,000 dots go in their own file, loaded only when the overlay is switched on:
    // [kind ('river' | 'lake'), name, status, county, lat, lon]
    const points = bodies.map(b => [b.kind, b.name, b.status, b.county, b.lat, b.lon]);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        period: PERIOD,
        counties,
        national,
        files: { 'waterquality-points.json': points }
    };
}

module.exports = { fetchWaterQuality };
