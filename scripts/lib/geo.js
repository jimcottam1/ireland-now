// County lookups: which county a point is in, and county names as written by different sources.
const fs = require('fs');
const path = require('path');

const counties = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'counties.geojson'), 'utf8')).features;

function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function polygonContains(rings, x, y) {
    if (!ringContains(rings[0], x, y)) return false;
    return !rings.slice(1).some(hole => ringContains(hole, x, y));
}

/** Area-weighted centroid of a county's largest polygon: a sensible "middle of the county". */
function centroidOf(feature) {
    let best = null;
    for (const rings of feature.geometry.coordinates) {
        const ring = rings[0];
        let area = 0, cx = 0, cy = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
            area += f;
            cx += (ring[j][0] + ring[i][0]) * f;
            cy += (ring[j][1] + ring[i][1]) * f;
        }
        if (!best || Math.abs(area) > Math.abs(best.area)) best = { area, lon: cx / (3 * area), lat: cy / (3 * area) };
    }
    return { lat: Number(best.lat.toFixed(4)), lon: Number(best.lon.toFixed(4)) };
}

const centroids = Object.fromEntries(counties.map(f => [f.properties.id, centroidOf(f)]));

/**
 * County id for a point. Coastal gauges and piers can sit just outside the simplified coastline,
 * so fall back to the nearest county centre within ~25 km.
 */
function countyAt(lon, lat) {
    for (const f of counties) {
        if (f.geometry.coordinates.some(rings => polygonContains(rings, lon, lat))) return f.properties.id;
    }
    let nearest = null;
    let best = Infinity;
    for (const f of counties) {
        for (const rings of f.geometry.coordinates) {
            for (const [x, y] of rings[0]) {
                const d = Math.hypot((x - lon) * Math.cos(lat * Math.PI / 180), y - lat);
                if (d < best) { best = d; nearest = f.properties.id; }
            }
        }
    }
    return best < 0.25 ? nearest : null;
}

const COUNTY_IDS = counties.map(f => f.properties.id);

/** "Co. Kilkenny", "KILKENNY", "Dún Laoghaire-Rathdown County Council" -> "kilkenny" / "dublin". */
function countyFromName(text) {
    if (!text) return null;
    const t = String(text).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/laoighis|leix/g, 'laois');
    if (/dublin|fingal|dun laoghaire|rathdown/.test(t)) return 'dublin';
    return COUNTY_IDS.find(id => new RegExp(`\\b${id}\\b`).test(t)) || null;
}

/** Every county named in a string, e.g. a Dáil constituency like "Carlow-Kilkenny". */
function countiesInName(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/dublin|dun laoghaire/.test(t)) return ['dublin'];
    return COUNTY_IDS.filter(id => new RegExp(`\\b${id}\\b`).test(t));
}

module.exports = { counties, centroids, countyAt, countyFromName, countiesInName, COUNTY_IDS };
