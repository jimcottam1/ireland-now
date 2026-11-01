// Air quality: Open-Meteo model estimates for the middle of each county, from a saved real response.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { centroids, COUNTY_IDS } = require('../scripts/lib/geo');

const results = () => JSON.parse(fixture('openmeteo-airquality.json').toString());
async function run(body = results(), seen = []) {
    mockHttp([[/air-quality-api\.open-meteo\.com/, url => { seen.push(url); return body; }]]);
    return loadLayer('airquality').fetchAirQuality();
}

test('asks for every county centre in one request and gives each county its own answer', async () => {
    const ids = Object.keys(centroids);
    const body = results();
    body.forEach((r, i) => { r.current.european_aqi = 10 + i; r.current.pm2_5 = i + 0.04; });   // a different number per position
    const seen = [];
    const d = await run(body, seen);

    const q = new URL(seen[0]).searchParams;
    assert.deepEqual(q.get('latitude').split(',').map(Number), ids.map(id => centroids[id].lat));
    assert.deepEqual(q.get('longitude').split(',').map(Number), ids.map(id => centroids[id].lon));
    assert.equal(q.get('timezone'), 'GMT');

    assert.deepEqual(Object.keys(d.counties), ids);
    assert.equal(ids.length, 32, 'the whole island');
    ids.forEach((id, i) => {
        assert.equal(d.counties[id].aqi, 10 + i, `${id} gets answer ${i}`);
        assert.equal(d.counties[id].pm25, i);
    });
    assert.ok(COUNTY_IDS.every(id => d.counties[id]));
});

test('reads the pollutants, rounds them to a decimal place, and stamps the model hour as UTC', async () => {
    const body = results();
    Object.assign(body[0].current, { time: '2026-11-01T21:00', european_aqi: 23.4, pm2_5: 2.94, pm10: 6.66, nitrogen_dioxide: 2.95, ozone: 65.04 });
    const d = await run(body);
    assert.deepEqual(d.counties.antrim, { time: '2026-11-01T21:00:00Z', aqi: 23, band: 'Fair', pm25: 2.9, pm10: 6.7, no2: 3, ozone: 65 });
    assert.equal(d.sourceTime, '2026-11-01T21:00:00Z');
    assert.ok(d.source.name.includes('Open-Meteo'));
});

test('bands follow the European Air Quality Index, with the top of each band inside it', async () => {
    const cases = [[0, 'Good'], [20, 'Good'], [21, 'Fair'], [40, 'Fair'], [41, 'Moderate'], [60, 'Moderate'], [61, 'Poor'], [80, 'Poor'], [81, 'Very poor'], [100, 'Very poor'], [101, 'Extremely poor'], [250, 'Extremely poor']];
    const body = results();
    for (const [aqi, band] of cases) {
        body[0].current.european_aqi = aqi;
        const d = await run(body);
        assert.equal(d.counties.antrim.band, band, `AQI ${aqi}`);
    }
});

test('the band matches the rounded number shown', { todo: 'BUG: the band uses the unrounded index, so 20.4 is shown as "20" but banded Fair (Good ends at 20)' }, async () => {
    const body = results();
    body[0].current.european_aqi = 20.4;
    const d = await run(body);
    assert.equal(d.counties.antrim.aqi, 20);
    assert.equal(d.counties.antrim.band, 'Good');
});

test('a missing pollutant stays null rather than becoming zero', async () => {
    const body = results();
    Object.assign(body[1].current, { european_aqi: null, pm2_5: null, pm10: null, nitrogen_dioxide: null, ozone: null });
    const d = await run(body);
    assert.deepEqual(d.counties.armagh, { time: body[1].current.time + ':00Z', aqi: null, band: null, pm25: null, pm10: null, no2: null, ozone: null });
});

test('an error answer, or too few answers, throws', async () => {
    await assert.rejects(run({ error: true, reason: 'Too many requests' }));
    await assert.rejects(run([]));
    await assert.rejects(run(results().slice(0, 20)));
    await assert.rejects(run('<html>Bad gateway</html>'));
});
