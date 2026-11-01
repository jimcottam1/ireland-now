// Forecast: Met Éireann point forecast XML, a saved real Dublin answer plus small hand-made ones for the awkward cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const { centroids } = require('../scripts/lib/geo');

const WINTER_NOW = '2026-11-01T21:42:00Z';   // the saved answer was fetched at this moment; Irish time is UTC in winter
const dublinXml = () => fixture('met-forecast-dublin.xml').toString();

/** Hand-made forecast pieces. */
const instant = (at, temp, gust) => `<time datatype="forecast" from="${at}" to="${at}"><location><temperature id="TTT" unit="celsius" value="${temp}"/><windGust id="ff_gust" mps="${gust}"/></location></time>`;
const interval = (from, to, rain, symbol = 'Cloud') => `<time datatype="forecast" from="${from}" to="${to}"><location><precipitation unit="mm" value="${rain}"/><symbol id="${symbol}" number="1"/></location></time>`;
const doc = (...parts) => `<weatherdata><product class="pointData">${parts.join('')}</product></weatherdata>`;

/** Run the layer with the same answer for every county (or a function of the request). */
async function run(t, now, body, seen = []) {
    freezeClock(t, now);
    mockHttp([[/openaccess\.pf\.api\.met\.ie/, url => { seen.push(url); return typeof body === 'function' ? body(url) : body; }]]);
    return loadLayer('forecast').fetchForecast();
}
const dublin = async (t, now, body) => (await run(t, now, body)).counties.dublin;

test('real Dublin answer: three days from today, with min, max, rain, gust and summary', async t => {
    const days = await dublin(t, WINTER_NOW, dublinXml());
    assert.deepEqual(days.map(d => d.date), ['2026-11-01', '2026-11-02', '2026-11-03']);

    // Work the first full day out independently from the XML (in winter Irish time is UTC)
    const xml = dublinXml();
    const times = [...xml.matchAll(/<time datatype="forecast" from="([^"]+)" to="([^"]+)">([\s\S]*?)<\/time>/g)].map(m => ({ from: m[1], to: m[2], body: m[3] }));
    const day = '2026-11-02';
    const temps = times.filter(x => x.from === x.to && x.to.startsWith(day)).map(x => parseFloat(x.body.match(/temperature[^>]*value="([^"]+)"/)[1]));
    const gusts = times.filter(x => x.from === x.to && x.to.startsWith(day)).map(x => parseFloat(x.body.match(/windGust[^>]*mps="([^"]+)"/)[1]));
    const rain = times.filter(x => x.from !== x.to && x.to.startsWith(day)).reduce((s, x) => s + parseFloat(x.body.match(/precipitation[^>]*value="([^"]+)"/)[1]), 0);
    const d2 = days[1];
    assert.equal(d2.min, Math.round(Math.min(...temps)));
    assert.equal(d2.max, Math.round(Math.max(...temps)));
    assert.equal(d2.gustKmh, Math.round(Math.max(...gusts) * 3.6));
    assert.equal(d2.rain, Number(rain.toFixed(1)));
    assert.ok(d2.min < d2.max && d2.min > -10 && d2.max < 30);
    assert.equal(typeof d2.summary, 'string');
    // The first day is only the last two hours: still a day, from what there is
    assert.ok(days[0].min <= days[0].max);
});

test('every county is asked for at its centre, and gets its own answer', async t => {
    const ids = Object.keys(centroids);
    const seen = [];
    const d = await run(t, WINTER_NOW, url => {
        const lat = Number(url.match(/lat=([\d.]+)/)[1]);
        return doc(instant('2026-11-02T12:00:00Z', lat, 1));   // temperature = latitude, so each county's answer is recognisable
    }, seen);
    assert.equal(seen.length, 32);
    assert.deepEqual(Object.keys(d.counties).sort(), [...ids].sort());
    for (const id of ids) {
        assert.equal(d.counties[id][0].max, Math.round(centroids[id].lat), id);
        assert.ok(seen.includes(`http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=${centroids[id].lat};long=${centroids[id].lon}`));
    }
    assert.ok(d.source.name.includes('Met'));
});

test('rain counts only the 1-hour intervals: longer ones repeat the same rain', async t => {
    const days = await dublin(t, '2026-11-02T08:00:00Z', doc(
        instant('2026-11-02T12:00:00Z', 8, 4),
        interval('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', 1.2),
        interval('2026-11-02T11:00:00Z', '2026-11-02T12:00:00Z', 0.5),
        interval('2026-11-02T09:00:00Z', '2026-11-02T12:00:00Z', 1.7),     // 3 hours: the same rain again
        interval('2026-11-02T06:00:00Z', '2026-11-02T12:00:00Z', 1.7)      // 6 hours: and again
    ));
    assert.equal(days[0].rain, 1.7);
});

test('temperature, gust and rain are taken from the right kind of entry', async t => {
    const days = await dublin(t, '2026-11-02T08:00:00Z', doc(
        instant('2026-11-02T06:00:00Z', 3.4, 5),
        instant('2026-11-02T12:00:00Z', 11.5, 12.5),
        instant('2026-11-02T18:00:00Z', 7, 2),
        interval('2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z', 0)
    ));
    assert.deepEqual([days[0].min, days[0].max, days[0].gustKmh, days[0].rain], [3, 12, 45, 0]);
});

test('days are Irish calendar days: in summer 23:30 UTC is already tomorrow', async t => {
    const days = await dublin(t, '2026-06-30T12:00:00Z', doc(
        instant('2026-06-30T20:00:00Z', 14, 3),     // 21:00 on 30 June
        instant('2026-06-30T22:30:00Z', 12, 3),     // 23:30 on 30 June
        instant('2026-06-30T23:30:00Z', 10, 3),     // 00:30 on 1 July
        instant('2026-07-01T10:00:00Z', 18, 3)
    ));
    assert.deepEqual(days.map(d => [d.date, d.min, d.max]), [['2026-06-30', 12, 14], ['2026-07-01', 10, 18]]);
});

test('"today" is the Irish date: yesterday is dropped even when it is still today in UTC', async t => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Ireland
    const days = await dublin(t, '2026-06-30T23:30:00Z', doc(
        instant('2026-06-30T20:00:00Z', 14, 3),
        instant('2026-07-01T10:00:00Z', 18, 3),
        instant('2026-07-02T10:00:00Z', 17, 3)
    ));
    assert.deepEqual(days.map(d => d.date), ['2026-07-01', '2026-07-02']);
});

test('at most three days, and a day with no temperatures is skipped', async t => {
    const parts = [1, 2, 3, 4, 5].map(n => instant(`2026-11-0${n}T12:00:00Z`, n, 1));
    let days = await dublin(t, '2026-11-01T08:00:00Z', doc(...parts));
    assert.deepEqual(days.map(d => d.date), ['2026-11-01', '2026-11-02', '2026-11-03']);

    days = await dublin(t, '2026-11-01T08:00:00Z', doc(parts[0], interval('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', 2), parts[2]));
    assert.deepEqual(days.map(d => d.date), ['2026-11-01', '2026-11-03'], 'rain alone does not make a day');
});

test('the summary is the commonest daytime weather, in plain words', async t => {
    const sym = (hour, symbol) => interval(`2026-11-02T${String(hour - 1).padStart(2, '0')}:00:00Z`, `2026-11-02T${String(hour).padStart(2, '0')}:00:00Z`, 0, symbol);
    const day = (...parts) => doc(instant('2026-11-02T12:00:00Z', 9, 2), ...parts);
    const summary = async (...parts) => (await dublin(t, '2026-11-02T00:30:00Z', day(...parts)))[0].summary;

    assert.equal(await summary(sym(9, 'LightRainSun'), sym(10, 'LightRainSun'), sym(11, 'Sun')), 'Showers');
    assert.equal(await summary(sym(9, 'Rain'), sym(10, 'HeavyRain'), sym(11, 'Rain')), 'Rain');
    assert.equal(await summary(sym(9, 'LightRain'), sym(10, 'Drizzle'), sym(11, 'Sun')), 'Light rain');
    assert.equal(await summary(sym(9, 'PartlyCloud'), sym(10, 'PartlyCloud'), sym(11, 'Cloud')), 'Partly cloudy');
    assert.equal(await summary(sym(9, 'LightCloud'), sym(10, 'LightCloud'), sym(11, 'Cloud')), 'Mostly sunny');
    assert.equal(await summary(sym(9, 'Cloud'), sym(10, 'Cloud'), sym(11, 'Sun')), 'Cloudy');
    assert.equal(await summary(sym(9, 'Sun'), sym(10, 'Sun'), sym(11, 'Cloud')), 'Sunny');
    assert.equal(await summary(sym(9, 'Fog'), sym(10, 'Fog')), 'Fog');
    assert.equal(await summary(sym(9, 'Snow'), sym(10, 'Snow')), 'Snow');
    assert.equal(await summary(sym(9, 'Sleet'), sym(10, 'Sleet')), 'Sleet');
    assert.equal(await summary(sym(9, 'LightRainThunderSun'), sym(10, 'LightRainThunderSun')), 'Thunder');
    assert.equal(await summary(), null, 'no symbols, no summary');
    // Night-time hours are ignored: three clear hours at night do not beat one cloudy hour by day
    assert.equal(await summary(sym(2, 'Sun'), sym(3, 'Sun'), sym(4, 'Sun'), sym(13, 'Cloud')), 'Cloudy');
    assert.equal(await summary(sym(21, 'Fog'), sym(14, 'Sun')), 'Sunny', 'after 8pm is night too');
});

test('daytime means 8am to 8pm Irish time, not UTC', async t => {
    // An hour is judged by when it starts. In summer 07:00 UTC is 08:00 Irish time (daytime); 19:00 and 20:00 UTC are 20:00 and 21:00 (night)
    const sym = (startUtcHour, symbol) => interval(`2026-07-01T${String(startUtcHour).padStart(2, '0')}:00:00Z`, `2026-07-01T${String(startUtcHour + 1).padStart(2, '0')}:00:00Z`, 0, symbol);
    const days = await dublin(t, '2026-07-01T00:30:00Z', doc(instant('2026-07-01T12:00:00Z', 16, 2), sym(7, 'Fog'), sym(8, 'Fog'), sym(18, 'Fog'), sym(19, 'Snow'), sym(20, 'Snow'), sym(6, 'Snow'), sym(6, 'Snow'), sym(6, 'Snow')));
    assert.equal(days[0].summary, 'Fog');
});

test('the last hour of the day is counted in that day', async t => {
    const days = await dublin(t, '2026-11-02T08:00:00Z', doc(
        instant('2026-11-02T12:00:00Z', 8, 1), instant('2026-11-03T12:00:00Z', 8, 1),
        interval('2026-11-02T23:00:00Z', '2026-11-03T00:00:00Z', 4.0)      // 23:00 to midnight on the 2nd
    ));
    assert.equal(days[0].rain, 4);
    assert.equal(days[1].rain, 0);
});

test('in summer the last hour is judged in Irish time too', async t => {
    // 22:00-23:00 UTC is 23:00-24:00 on 2 July in Ireland; 23:00-00:00 UTC is the first hour of the 3rd
    const days = await dublin(t, '2026-07-02T08:00:00Z', doc(
        instant('2026-07-02T12:00:00Z', 15, 1), instant('2026-07-03T12:00:00Z', 15, 1),
        interval('2026-07-02T22:00:00Z', '2026-07-02T23:00:00Z', 2.5),
        interval('2026-07-02T23:00:00Z', '2026-07-03T00:00:00Z', 1)
    ));
    assert.deepEqual(days.map(d => [d.date, d.rain]), [['2026-07-02', 2.5], ['2026-07-03', 1]]);
});

test('a few counties with unusable answers are left out; most of them throws', async t => {
    const warn = console.warn; console.warn = () => {};
    try {
        const ok = doc(instant('2026-11-02T12:00:00Z', 9, 2));
        const d = await run(t, WINTER_NOW, url => (url.includes('lat=54.868;') ? '<html>Oops</html>' : ok));
        assert.ok(!('antrim' in d.counties), 'HTML for one county leaves it out');
        assert.equal(Object.keys(d.counties).length, 31);
    } finally { console.warn = warn; }
});

test('a county that fails is left out; more than half failing throws', async t => {
    const warn = console.warn; console.warn = () => {};
    try {
        const ok = doc(instant('2026-11-02T12:00:00Z', 9, 2));
        const failFor = ids => url => {
            const lat = url.match(/lat=([\d.]+)/)[1];
            if (ids.some(id => String(centroids[id].lat) === lat)) throw new Error('timeout');
            return ok;
        };
        const some = await run(t, WINTER_NOW, failFor(['kerry', 'mayo']));
        assert.ok(!('kerry' in some.counties) && !('mayo' in some.counties));
        assert.equal(Object.keys(some.counties).length, 30);

        const ids = Object.keys(centroids);
        await assert.rejects(run(t, WINTER_NOW, failFor(ids.slice(0, 17))), /17 counties/);
    } finally { console.warn = warn; }
});

test('an unrecognised answer for every county throws rather than publishing empty forecasts', async t => {
    await assert.rejects(run(t, WINTER_NOW, '<html><body>Service unavailable</body></html>'));
});
