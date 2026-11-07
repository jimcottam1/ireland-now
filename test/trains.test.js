// Irish Rail current trains: a saved answer (7 November 2026, 22:24, 40 trains of which 27 running).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');

const xml = fixture('irishrail-trains.xml').toString();
const EMPTY = '<?xml version="1.0" encoding="utf-8"?>\n<ArrayOfObjTrainPositions xmlns="http://api.irishrail.ie/realtime/" />';

async function run(body) {
    mockHttp([[/api\.irishrail\.ie/, body]]);
    return loadLayer('trains').fetchTrains();
}

test('reads every running train with a position from a saved answer', async () => {
    const d = await run(xml);
    // Irish Rail gives some running trains a position of 0,0 (4 in this answer); those can't be placed
    const blocks = xml.match(/<objTrainPositions>[\s\S]*?<\/objTrainPositions>/g);
    const running = blocks.filter(b => /<TrainStatus>R</.test(b) && !/<TrainLatitude>0</.test(b)).length;
    assert.ok(running > 10);
    assert.equal(d.trains.length, running);
    assert.equal(d.national.running, running);
    for (const t of d.trains) {
        assert.match(t.code, /^[A-Z0-9]{3,6}$/);
        assert.ok(t.lat > 51 && t.lat < 55.5 && t.lon > -10.5 && t.lon < -5.5, `${t.code} is off the island`);
        assert.ok(t.county, `${t.code} has no county`);
    }
});

test('no trains running (late at night, Christmas Day) is published as zero', async () => {
    const d = await run(EMPTY);
    assert.deepEqual(d.trains, []);
    assert.equal(d.national.running, 0);
});

test('an answer that is not the train list fails, so the last good copy is kept', async () => {
    await assert.rejects(run('<html><body>Service unavailable</body></html>'), /not recognised/);
    await assert.rejects(run(''), /not recognised/);
});

test('trains whose fields have been renamed fail rather than vanish', async () => {
    await assert.rejects(run(xml.replace(/TrainCode>/g, 'Code>')), /layout changed/);
});
