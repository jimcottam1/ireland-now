// Air quality at the middle of each county, from Open-Meteo's air quality model (CAMS Europe).
// These are model estimates, not station measurements: the EPA doesn't offer a public feed.
const { getJson } = require('../lib/http');
const { centroids } = require('../lib/geo');

const SOURCE = {
    name: 'Open-Meteo air quality (Copernicus CAMS)',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    licence: 'CC BY 4.0'
};

// European Air Quality Index bands
const BANDS = [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']];
const band = aqi => aqi == null ? null : BANDS.find(([max]) => aqi <= max)[1];
const round = v => v == null ? null : Math.round(v * 10) / 10;

async function fetchAirQuality() {
    const ids = Object.keys(centroids);
    const params = new URLSearchParams({
        latitude: ids.map(id => centroids[id].lat).join(','),
        longitude: ids.map(id => centroids[id].lon).join(','),
        current: 'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
        timezone: 'GMT'
    });
    const results = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);

    const counties = {};
    ids.forEach((id, i) => {
        const c = results[i].current;
        counties[id] = {
            time: c.time + ':00Z',
            aqi: c.european_aqi == null ? null : Math.round(c.european_aqi),
            band: band(c.european_aqi),
            pm25: round(c.pm2_5),
            pm10: round(c.pm10),
            no2: round(c.nitrogen_dioxide),
            ozone: round(c.ozone)
        };
    });

    // The model hour these estimates are for
    const sourceTime = Object.values(counties)[0]?.time || null;
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime, counties };
}

module.exports = { fetchAirQuality };
