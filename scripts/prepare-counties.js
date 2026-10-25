/**
 * One-off: download Tailte Éireann's county boundaries (WGS84) and simplify them for the web.
 * Writes public/data/counties.geojson, which is committed. Re-run only if boundaries change.
 *
 * Source: Counties - National Statutory Boundaries - 2019 - Generalised 20m, Tailte Éireann, CC BY 4.0
 */
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://data-osi.opendata.arcgis.com/api/download/v1/items/7ef9c5102d61424295e98505a00251ea/geojson?layers=0&spatialRefId=4326';
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

async function main() {
    console.log('Downloading county boundaries...');
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'IrelandNow/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.json();

    const features = source.features.map(f => {
        const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        const simplified = polygons
            .map(rings => rings.map(simplifyRing).filter(Boolean))
            .filter(rings => rings.length && rings[0]);
        return {
            type: 'Feature',
            properties: {
                id: f.properties.COUNTY.toLowerCase(),
                name: titleCase(f.properties.COUNTY),
                irish: f.properties.GAEILGE,
                province: f.properties.PROVINCE
            },
            geometry: { type: 'MultiPolygon', coordinates: simplified }
        };
    }).sort((a, b) => a.properties.name.localeCompare(b.properties.name));

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
    console.log(`Wrote ${features.length} counties, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
