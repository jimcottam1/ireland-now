// Luas: stops and the line-wide status message, read from the saved feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

const routes = (greenFile = 'luas-forecast-green.xml') => [
    [/action=stops/, fixture('luas-stops.xml')],
    [/stop=ABB/, fixture('luas-forecast-red.xml')],
    [/stop=STS/, fixture(greenFile)]
];

test('parses stops onto the right line, inside Dublin', async () => {
    mockHttp(routes());
    const d = await loadLayer('luas').fetchLuas();
    const red = d.stops.filter(s => s.line === 'red');
    const green = d.stops.filter(s => s.line === 'green');
    assert.ok(red.length > 25 && green.length > 30, `got ${red.length} red, ${green.length} green`);
    assert.equal(red.length + green.length, d.stops.length);
    assert.ok(red.some(s => s.code === 'TPT' && s.name === 'The Point'));
    assert.ok(green.some(s => s.code === 'STS' && s.name === "St. Stephen's Green"));
    assert.ok(!red.some(s => s.code === 'STS'), 'a green stop is not on the red line');
    for (const s of d.stops) {
        assert.ok(s.lat > 53.2 && s.lat < 53.45 && s.lon > -6.5 && s.lon < -6.0, `${s.name} is outside Dublin`);
        assert.equal(typeof s.parkRide, 'boolean');
    }
    assert.ok(d.stops.some(s => s.parkRide), 'some stops have park and ride');
    assert.ok(d.source.name.includes('Luas'));
});

test('normal and disrupted messages', async () => {
    mockHttp(routes());
    let d = await loadLayer('luas').fetchLuas();
    assert.equal(d.lines.red.normal, true);
    assert.equal(d.lines.green.normal, true);
    assert.equal(d.lines.red.message, 'Red Line services operating normally');

    mockHttp(routes('luas-forecast-green-delays.xml'));
    d = await loadLayer('luas').fetchLuas();
    assert.equal(d.lines.green.normal, false);
    assert.equal(d.lines.green.message, 'Green Line services operating with delays');
    assert.equal(d.lines.red.normal, true, 'the red line is unaffected');
});

test('sourceTime converts Irish time to UTC', async () => {
    // Winter: Irish time is UTC
    mockHttp(routes());
    let d = await loadLayer('luas').fetchLuas();
    assert.equal(d.sourceTime, '2026-11-01T20:59:00.000Z');
    // Summer: Irish time is UTC+1, so the same wall clock is an hour earlier in UTC
    const summer = fixture('luas-forecast-red.xml').toString().replace('2026-11-01T20:59:37', '2026-07-01T20:59:37');
    mockHttp([[/action=stops/, fixture('luas-stops.xml')], [/stop=ABB/, summer], [/stop=STS/, summer.replace('Red Line', 'Green Line')]]);
    d = await loadLayer('luas').fetchLuas();
    assert.equal(d.sourceTime, '2026-07-01T19:59:00.000Z');
    // The newest of the two lines wins
    mockHttp([[/action=stops/, fixture('luas-stops.xml')], [/stop=ABB/, summer], [/stop=STS/, fixture('luas-forecast-green.xml')]]);
    d = await loadLayer('luas').fetchLuas();
    assert.equal(d.sourceTime, '2026-11-01T20:59:00.000Z');
});

test('an unrecognised response throws', async () => {
    mockHttp([[/action=stops/, '<html>Maintenance</html>']]);
    await assert.rejects(loadLayer('luas').fetchLuas());

    mockHttp([[/action=stops/, fixture('luas-stops.xml')], [/action=forecast/, '<stopInfo created="2026-11-01T20:59:37"></stopInfo>']]);
    await assert.rejects(loadLayer('luas').fetchLuas(), /message/);

    const redOnly = fixture('luas-stops.xml').toString().replace(/<line name="Luas Green Line">[\s\S]*<\/line>/, '');
    mockHttp([[/action=stops/, redOnly], ...routes().slice(1)]);
    await assert.rejects(loadLayer('luas').fetchLuas(), /green/);
});
