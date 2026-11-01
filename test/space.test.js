// Space weather: NOAA Kp index and the aurora outlook, from a saved real forecast file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

const NOW = '2026-11-01T21:50:00Z';   // the saved file's last observed value is for 21:00 that evening
const rows = () => JSON.parse(fixture('noaa-kp-forecast.json').toString());
async function run(t, body = rows(), now = NOW) {
    freezeClock(t, now);
    mockHttp([[/services\.swpc\.noaa\.gov/, body]]);
    return (await loadLayer('space').fetchSpace()).national;
}
const row = (time, kp, observed) => ({ time_tag: time, kp, observed, noaa_scale: null });

test('real file: latest measured Kp, the peak predicted in the next 24 hours, and the history', async t => {
    const n = await run(t);
    assert.equal(n.kp, 4.7, 'the 21:00 value is an estimate, and it is the latest');
    assert.equal(n.kpTime, '2026-11-01T21:00:00.000Z');
    assert.equal(n.peakKp, 3);
    assert.equal(n.peakTime, '2026-11-02T03:00:00.000Z', 'the first of the equal 3.0 values');
    assert.equal(n.history.length, 24);
    assert.deepEqual(n.history.at(-1), ['2026-11-01T21:00:00.000Z', 4.67]);
    assert.equal(n.history[0][0], '2026-10-30T00:00:00.000Z');
    assert.ok(n.history.every(([time]) => time <= '2026-11-01T21:00:00.000Z'), 'no predictions in the history');
    assert.deepEqual(n.aurora, { level: 'none', text: 'Unlikely' });
});

test('aurora chance steps at Kp 5, 6 and 7, using the higher of now and the coming peak', async t => {
    const at = async (observedKp, predictedKp) => (await run(t, [row('2026-11-01T18:00:00', observedKp, 'observed'), row('2026-11-02T03:00:00', predictedKp, 'predicted')])).aurora.level;
    assert.equal(await at(4.67, 4.67), 'none');
    assert.equal(await at(4.99, 1), 'none');
    assert.equal(await at(5, 1), 'low');
    assert.equal(await at(5.67, 1), 'low');
    assert.equal(await at(6, 1), 'possible');
    assert.equal(await at(6.67, 1), 'possible');
    assert.equal(await at(7, 1), 'good');
    assert.equal(await at(9, 1), 'good');
    // A coming storm counts even when it is quiet now
    assert.equal(await at(2, 5), 'low');
    assert.equal(await at(2, 6.33), 'possible');
    assert.equal(await at(2, 7), 'good');
    // A storm that has passed does not
    assert.equal(await at(2, 2), 'none');
    const n = await run(t, [row('2026-11-01T18:00:00', 6, 'observed')]);
    assert.equal(n.aurora.text, 'Possible, especially in the north');
});

test('only predictions from the last 3 hours to the next 24 count towards the peak', async t => {
    const n = await run(t, [
        row('2026-11-01T21:00:00', 2, 'observed'),
        row('2026-11-01T15:00:00', 8, 'predicted'),     // 6.8 hours ago: too old
        row('2026-11-01T19:00:00', 4, 'predicted'),     // 2.8 hours ago: counts
        row('2026-11-02T21:00:00', 5, 'predicted'),     // 23.2 hours ahead: counts
        row('2026-11-02T22:00:00', 9, 'predicted')      // 24.2 hours ahead: too far
    ]);
    assert.equal(n.peakKp, 5);
    assert.equal(n.peakTime, '2026-11-02T21:00:00.000Z');
    assert.equal(n.aurora.level, 'low');
});

test('Kp values given as text are read as numbers, and rows without a Kp are skipped', async t => {
    const n = await run(t, [row('2026-11-01T12:00:00', '3.33', 'observed'), { time_tag: '2026-11-01T15:00:00', kp: null, observed: 'observed' }, row('2026-11-01T18:00:00', '2.67', 'observed'), { kp: 3, observed: 'predicted' }]);
    assert.equal(n.kp, 2.7);
    assert.equal(n.kpTime, '2026-11-01T18:00:00.000Z');
    assert.deepEqual(n.history, [['2026-11-01T12:00:00.000Z', 3.33], ['2026-11-01T18:00:00.000Z', 2.67]]);
    assert.equal(n.peakKp, null);
    assert.equal(n.peakTime, null);
});

test('times are UTC even though the file does not say so', async t => {
    // If these were read as local time the answer would shift by the machine's time zone
    const n = await run(t, [row('2026-07-01T09:00:00', 3, 'observed')], '2026-07-01T10:00:00Z');
    assert.equal(n.kpTime, '2026-07-01T09:00:00.000Z');
});

test('an unrecognised response throws', async t => {
    await assert.rejects(run(t, { error: 'down' }));
    await assert.rejects(run(t, '<html>Maintenance</html>'));
});

test('a quiet day (low Kp) is a normal answer, not an error', async t => {
    const n = await run(t, [row('2026-11-01T18:00:00', 0.33, 'observed'), row('2026-11-02T00:00:00', 0.67, 'predicted')]);
    assert.equal(n.kp, 0.3);
    assert.equal(n.aurora.level, 'none');
});

test('a file with only predictions throws', async t => {
    await assert.rejects(run(t, [row('2026-11-02T00:00:00', 3, 'predicted')]));
});

test('a file with no readings at all throws', async t => {
    await assert.rejects(run(t, []));
});
