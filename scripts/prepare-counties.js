/**
 * One-off: download Tailte Éireann's county boundaries (WGS84) and simplify them for the web.
 * Writes public/data/counties.geojson, which is committed. Re-run only if boundaries change.
 *
 * Sources:
 *   Republic of Ireland: Counties - National Statutory Boundaries - 2019 - Generalised 20m, Tailte Éireann, CC BY 4.0
 *   Northern Ireland: OSNI Open Data - Largescale Boundaries - County Boundaries, © Crown copyright, Open Government
 *   Licence. OSNI's own server (services.spatialni.gov.uk) was offline when this was written, so this reads Esri
 *   Ireland's published copy of the same dataset.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://data-osi.opendata.arcgis.com/api/download/v1/items/7ef9c5102d61424295e98505a00251ea/geojson?layers=0&spatialRefId=4326';
const NI_SOURCE = 'https://services.arcgis.com/pMnvm7HXxTmNXxGi/arcgis/rest/services/OSNI_Open_Data_Largescale_Boundaries__County_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=CountyName&outSR=4326&f=geojson';

// OSNI gives names only; ids, display names and Irish names for the six counties
const NI_COUNTIES = {
    ANTRIM: ['antrim', 'Antrim', 'Aontroim'],
    ARMAGH: ['armagh', 'Armagh', 'Ard Mhacha'],
    DOWN: ['down', 'Down', 'An Dún'],
    FERMANAGH: ['fermanagh', 'Fermanagh', 'Fear Manach'],
    LONDONDERRY: ['londonderry', 'Derry / Londonderry', 'Doire'],
    TYRONE: ['tyrone', 'Tyrone', 'Tír Eoghain']
};
const OUT = path.join(__dirname, '..', 'public', 'data', 'counties.geojson');
const TOLERANCE = 0.002; // degrees, roughly 150-200 m
const DECIMALS = 4;      // roughly 10 m

function perpendicularDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker, iterative so long coastlines don't overflow the stack. */
function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i++) {
            const d = perpendicularDistance(points[i], points[first], points[last]);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > tolerance && index !== -1) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

const round = n => Number(n.toFixed(DECIMALS));

function simplifyRing(ring) {
    const simplified = simplify(ring, TOLERANCE).map(([x, y]) => [round(x), round(y)]);
    return simplified.length >= 4 ? simplified : null; // drop slivers and tiny islands
}

function titleCase(name) {
    return name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function download(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'IrelandNow/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
}

function simplifyGeometry(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return {
        type: 'MultiPolygon',
        coordinates: polygons.map(rings => rings.map(simplifyRing).filter(Boolean)).filter(rings => rings.length && rings[0])
    };
}

async function main() {
    console.log('Downloading county boundaries...');
    const [roi, ni] = await Promise.all([download(SOURCE), download(NI_SOURCE)]);

    const features = [
        ...roi.features.map(f => ({
            type: 'Feature',
            properties: {
                id: f.properties.COUNTY.toLowerCase(),
                name: titleCase(f.properties.COUNTY),
                irish: f.properties.GAEILGE,
                province: f.properties.PROVINCE,
                jurisdiction: 'roi'
            },
            geometry: simplifyGeometry(f.geometry)
        })),
        ...ni.features.map(f => {
            const [id, name, irish] = NI_COUNTIES[String(f.properties.CountyName).toUpperCase()];
            return {
                type: 'Feature',
                properties: { id, name, irish, province: 'Ulster', jurisdiction: 'ni' },
                geometry: simplifyGeometry(f.geometry)
            };
        })
    ].sort((a, b) => a.properties.name.localeCompare(b.properties.name));

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
    console.log(`Wrote ${features.length} counties, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
