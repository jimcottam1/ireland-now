// EPA radon risk map: for each 10 km grid square, the share of homes estimated to be above the radon
// reference level (200 Bq/m³). Squares at 10% or more are High Radon Areas. CC BY 4.0, from the EPA's
// GeoServer (gis.epa.ie, robots.txt allows it). The map changes rarely, so it is fetched monthly.
//
// The squares are in Irish Grid metres; coastal ones are cut to the coastline, so each is snapped back to the
// 10 km cell it sits in. That keeps the file small (a square is four numbers) and draws a clean grid.
const { getJson } = require('../lib/http');
const { irishGridToLatLon } = require('../lib/itm');
const { countyAt, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'EPA radon risk map',
    url: 'https://www.epa.ie/environment-and-you/radon/radon-map/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const WFS = 'https://gis.epa.ie/geoserver/EPA/ows?service=WFS&version=1.0.0&request=GetFeature'
    + '&typeName=EPA:RAD_RadonMap&outputFormat=application/json&propertyName=PERCENT_,Shape';
const CELL = 10000;
const MIN_SQUARES = 700;   // 868 cover the Republic
const HIGH = 10;           // per cent: a High Radon Area
const NO_DATA = -999;      // the map's mark for a square without an estimate
const MAX_NO_DATA = 50;

/** The 10 km cell (south-west corner, Irish Grid metres) that a square's points sit in. */
function cellOf(coordinates) {
    const points = coordinates.flat(2);
    if (!points.length || points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error('Radon: a square has no usable points');
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x = Math.floor(Math.min(...xs) / CELL) * CELL;
    const y = Math.floor(Math.min(...ys) / CELL) * CELL;
    if (Math.max(...xs) > x + CELL + 1 || Math.max(...ys) > y + CELL + 1) throw new Error(`Radon: a square at ${x}, ${y} is bigger than 10 km`);
    return [x, y];
}

const round = n => Number(n.toFixed(4));

// The map covers the Republic only, but a border square's centre can fall in Northern Ireland and a coastal
// one's at sea: try the centre, then the middle of each quarter, for a county of the Republic
const SPOTS = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
function countyOf(x, y) {
    for (const [fx, fy] of SPOTS) {
        const [lat, lon] = irishGridToLatLon(x + CELL * fx, y + CELL * fy);
        const id = countyAt(lon, lat);
        if (ROI_IDS.includes(id)) return id;
    }
    return null;
}

async function fetchRadon() {
    const answer = await getJson(WFS, { timeoutMs: 120000 });
    if (!Array.isArray(answer?.features)) throw new Error('Radon: answer not recognised');

    let noData = 0;
    const seen = new Map();   // cell -> percentage
    const squares = [];
    const counties = {};
    for (const f of answer.features) {
        const percent = f.properties?.PERCENT_;
        if (percent === NO_DATA) { noData++; continue; }   // squares the EPA has no estimate for
        if (typeof percent !== 'number' || percent < 0 || percent > 100) throw new Error(`Radon: "${percent}" is not a percentage`);
        const [x, y] = cellOf(f.geometry?.coordinates || []);
        const key = `${x},${y}`;
        // The map repeats a few squares word for word; a repeat that disagrees means something is wrong
        if (seen.has(key)) {
            if (seen.get(key) !== percent) throw new Error(`Radon: two different values for the square at ${key}`);
            continue;
        }
        seen.set(key, percent);
        const [south, west] = irishGridToLatLon(x, y);
        const [north, east] = irishGridToLatLon(x + CELL, y + CELL);
        const county = countyOf(x, y);
        // "High" is judged on the EPA's exact figure (9.96% is not a High Radon Area, though it shows as 10.0)
        const high = percent >= HIGH;
        squares.push({ bounds: [round(south), round(west), round(north), round(east)], percent: Number(percent.toFixed(1)), high, county });
        if (ROI_IDS.includes(county)) {
            const c = (counties[county] ||= { squares: 0, high: 0 });
            c.squares++;
            if (high) c.high++;
        }
    }
    if (squares.length < MIN_SQUARES) throw new Error(`Radon: only ${squares.length} squares`);
    if (noData > MAX_NO_DATA) throw new Error(`Radon: ${noData} squares have no estimate`);
    for (const c of Object.values(counties)) c.highShare = Math.round(100 * c.high / c.squares);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        high: HIGH,
        squares,
        counties
    };
}

module.exports = { fetchRadon };
