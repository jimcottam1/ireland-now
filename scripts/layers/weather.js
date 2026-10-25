// Current weather at the middle of each county, from Open-Meteo (one request for all 26).
// Met Éireann's own forecast API was redirecting to a server that didn't respond when this was built.
const { getJson } = require('../lib/http');
const { centroids } = require('../lib/geo');

const SOURCE = {
    name: 'Open-Meteo weather',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0'
};

// WMO weather interpretation codes
const CODES = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
};

async function fetchWeather() {
    const ids = Object.keys(centroids);
    const params = new URLSearchParams({
        latitude: ids.map(id => centroids[id].lat).join(','),
        longitude: ids.map(id => centroids[id].lon).join(','),
        current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        forecast_days: '1',
        timezone: 'Europe/Dublin'
    });
    const results = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`);

    const counties = {};
    ids.forEach((id, i) => {
        const { current, daily } = results[i];
        counties[id] = {
            time: current.time,
            temperature: current.temperature_2m,
            precipitation: current.precipitation,
            windSpeed: Math.round(current.wind_speed_10m),
            windGust: Math.round(current.wind_gusts_10m),
            code: current.weather_code,
            description: CODES[current.weather_code] || 'Unknown',
            todayMax: daily.temperature_2m_max[0],
            todayMin: daily.temperature_2m_min[0],
            todayRain: daily.precipitation_sum[0]
        };
    });

    return { updatedAt: new Date().toISOString(), source: SOURCE, counties };
}

module.exports = { fetchWeather };
