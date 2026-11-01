// Met Éireann point forecast (HARMONIE and ECMWF models) for the middle of each county: next 3 days.
// The https address redirects to a server that doesn't answer, so this uses the http one.
const { getText } = require('../lib/http');
const { centroids } = require('../lib/geo');

const SOURCE = {
    name: 'Met Éireann forecast API',
    url: 'https://data.gov.ie/dataset/met-eireann-forecast-api',
    licence: 'CC BY 4.0'
};

const DAYS = 3;
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' });
const localHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', hourCycle: 'h23' });

/** Met.no symbol ids ("LightRainSun", "PartlyCloud") -> a short plain description. */
function describe(symbol) {
    const s = symbol || '';
    if (/Thunder/.test(s)) return 'Thunder';
    if (/Snow/.test(s)) return 'Snow';
    if (/Sleet/.test(s)) return 'Sleet';
    if (/(Rain|Drizzle)Sun/.test(s)) return 'Showers';
    if (/HeavyRain|^Rain/.test(s)) return 'Rain';
    if (/LightRain|Drizzle/.test(s)) return 'Light rain';
    if (/Fog/.test(s)) return 'Fog';
    if (/PartlyCloud/.test(s)) return 'Partly cloudy';
    if (/LightCloud/.test(s)) return 'Mostly sunny';
    if (/Cloud/.test(s)) return 'Cloudy';
    if (/Sun/.test(s)) return 'Sunny';
    return null;
}

const attr = (xml, tag, name) => {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`));
    return m ? m[1] : null;
};

function parse(xml) {
    const days = new Map();
    const day = date => {
        if (!days.has(date)) days.set(date, { date, min: Infinity, max: -Infinity, rain: 0, gust: 0, symbols: {} });
        return days.get(date);
    };
    for (const [, from, to, body] of xml.matchAll(/<time datatype="forecast" from="([^"]+)" to="([^"]+)">([\s\S]*?)<\/time>/g)) {
        const t = new Date(to);
        const date = localDate.format(t);
        if (from === to) {
            // Instant: temperature and wind
            const temp = parseFloat(attr(body, 'temperature', 'value'));
            const gust = parseFloat(attr(body, 'windGust', 'mps'));
            const d = day(date);
            if (Number.isFinite(temp)) { d.min = Math.min(d.min, temp); d.max = Math.max(d.max, temp); }
            if (Number.isFinite(gust)) d.gust = Math.max(d.gust, gust);
        } else if (new Date(to) - new Date(from) === 3600000) {
            // Hourly interval: rain and weather symbol (longer intervals repeat the same rain, so skip them)
            // Dated by its start, so rain from 23:00 to midnight stays on its own day
            const start = new Date(from);
            const d = day(localDate.format(start));
            d.rain += parseFloat(attr(body, 'precipitation', 'value')) || 0;
            const hour = Number(localHour.format(start));
            const text = describe(attr(body, 'symbol', 'id'));
            if (text && hour >= 8 && hour < 20) d.symbols[text] = (d.symbols[text] || 0) + 1;
        }
    }
    const today = localDate.format(new Date());
    return [...days.values()]
        .filter(d => d.date >= today && Number.isFinite(d.min))
        .slice(0, DAYS)
        .map(d => ({
            date: d.date,
            min: Math.round(d.min),
            max: Math.round(d.max),
            rain: Number(d.rain.toFixed(1)),
            gustKmh: Math.round(d.gust * 3.6),
            summary: Object.entries(d.symbols).sort((a, b) => b[1] - a[1])[0]?.[0] || null
        }));
}

async function fetchForecast() {
    const ids = Object.keys(centroids);
    const counties = {};
    const failed = [];
    // A few at a time, to be gentle with Met Éireann's server
    for (let i = 0; i < ids.length; i += 4) {
        await Promise.all(ids.slice(i, i + 4).map(async id => {
            const { lat, lon } = centroids[id];
            try {
                const xml = await getText(`http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=${lat};long=${lon}`, { timeoutMs: 45000 });
                const days = parse(xml);
                if (!days.length) throw new Error('no forecast days in the answer');   // HTML or an empty document
                counties[id] = days;
            } catch {
                failed.push(id);
            }
        }));
    }
    if (failed.length > ids.length / 2) throw new Error(`Forecast failed for ${failed.length} counties`);
    if (failed.length) console.warn(`   Forecast: no answer for ${failed.join(', ')}`);
    return { updatedAt: new Date().toISOString(), source: SOURCE, counties };
}

module.exports = { fetchForecast };
