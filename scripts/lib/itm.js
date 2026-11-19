// Irish grid coordinates to latitude and longitude, by the inverse Transverse Mercator series
// (Snyder, Map Projections, p. 63):
// - Irish Transverse Mercator (ITM, EPSG:2157): GRS80, origin 53.5°N 8°W, scale 0.99982, false origin 600,000 E 750,000 N.
//   ETRS89 latitude and longitude, which is GPS to within a metre.
// - Irish Grid (TM65, EPSG:29902), still used by many EPA layers: Airy Modified, origin 53.5°N 8°W, scale 1.000035,
//   false origin 200,000 E 250,000 N. Without the datum shift the result is on the old Ireland 1965 datum, which is
//   within about 100 m of GPS: fine for dots on a county map, not for surveying.

const ITM = { a: 6378137, f: 1 / 298.257222101, k0: 0.99982, fe: 600000, fn: 750000 };
const IRISH_GRID = { a: 6377340.189, f: 1 / 299.3249646, k0: 1.000035, fe: 200000, fn: 250000 };
const LAT0 = 53.5 * Math.PI / 180;
const LON0 = -8 * Math.PI / 180;

function inverse({ a, f, k0, fe, fn }) {
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const e4 = e2 * e2, e6 = e4 * e2;
    const meridian = phi => a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
        - (35 * e6 / 3072) * Math.sin(6 * phi));
    const m0 = meridian(LAT0);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

    return (easting, northing) => {
        const mu = (m0 + (northing - fn) / k0) / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
        const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
            + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
        const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
        const c1 = ep2 * cos1 * cos1;
        const t1 = tan1 * tan1;
        const n1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
        const r1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
        const d = (easting - fe) / (n1 * k0);
        const lat = phi1 - (n1 * tan1 / r1) * (d * d / 2
            - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24
            + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720);
        const lon = LON0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
            + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / cos1;
        return [lat * 180 / Math.PI, lon * 180 / Math.PI];
    };
}

/** [lat, lon] for an ITM easting and northing. */
const itmToLatLon = inverse(ITM);
/** [lat, lon] for an Irish Grid easting and northing (about 100 m from GPS; see above). */
const irishGridToLatLon = inverse(IRISH_GRID);

module.exports = { itmToLatLon, irishGridToLatLon };
