// NTA buses. The realtime feeds need a key, so these answers are built by hand in the shape of
// GTFS-Realtime JSON (header, entity[], vehicle / trip_update), with a tiny static timetable zip.
const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { mockHttp, loadLayer } = require('./helpers');

const timetable = (() => {
    const z = new AdmZip();
    z.addFile('agency.txt', Buffer.from('agency_id,agency_name,agency_url\r\n7778019,Dublin Bus,https://www.dublinbus.ie\r\n7778020,Bus Éireann,https://www.buseireann.ie\r\n'));
    z.addFile('routes.txt', Buffer.from('route_id,agency_id,route_short_name,route_long_name,route_type\r\n'
        + '4710_1,7778019,46A,"Phoenix Park - Dún Laoghaire",3\r\n4711_2,7778020,X30,"Limerick - Dublin Airport",3\r\n'));
    return z.toBuffer();
})();

const header = { gtfs_realtime_version: '2.0', incrementality: 'FULL_DATASET', timestamp: '1794087000' };
const vehicles = {
    header,
    entity: [
        { id: 'V1', vehicle: { trip: { trip_id: 'T1', route_id: '4710_1' }, position: { latitude: 53.2934, longitude: -6.1353 } } },
        { id: 'V2', vehicle: { trip: { trip_id: 'T2', route_id: '4711_2' }, position: { latitude: 52.6638, longitude: -8.6267 } } },
        { id: 'V3', vehicle: { trip: { trip_id: 'T3', route_id: 'unknown' } } }   // no position: skipped
    ]
};
const updates = {
    header,
    entity: [
        { id: 'T1', trip_update: { trip: { trip_id: 'T1' }, stop_time_update: [{ arrival: { delay: 420 } }] } },
        { id: 'T2', trip_update: { trip: { trip_id: 'T2' }, stop_time_update: [{ departure: { delay: 60 } }] } }
    ]
};

/** Run the layer with the realtime feeds answering `feeds`, skipping its one-minute wait between them. */
async function run(t, feeds = { Vehicles: vehicles, TripUpdates: updates }) {
    process.env.NTA_API_KEY = 'test-key';
    mockHttp([[/transportforireland\.ie/, timetable]]);
    t.mock.method(global, 'fetch', async url => {
        const feed = String(url).match(/gtfsr\/v2\/(\w+)/)[1];
        return { ok: true, status: 200, json: async () => feeds[feed] };
    });
    t.mock.timers.reset();   // a second run in the same test
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = loadLayer('buses').fetchBuses();
    let done = false;
    pending.then(() => { done = true; }, () => { done = true; });
    while (!done) {
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(61000);
    }
    return pending;
}

test('places each bus, names its route and works out how late it is', async t => {
    const d = await run(t);
    assert.equal(d.buses.length, 2);
    const [dublin, limerick] = d.buses;
    assert.deepEqual([dublin.route, dublin.operator, dublin.county, dublin.minutesLate], ['46A', 'Dublin Bus', 'dublin', 7]);
    assert.deepEqual([limerick.route, limerick.name, limerick.county, limerick.minutesLate], ['X30', 'Limerick - Dublin Airport', 'limerick', 1]);
    assert.equal(d.national.late, 1);
    assert.equal(d.sourceTime, new Date(1794087000 * 1000).toISOString());
});

test('no buses on the road (Christmas Day) is published as zero', async t => {
    const d = await run(t, { Vehicles: { header }, TripUpdates: { header } });
    assert.deepEqual(d.buses, []);
    assert.equal(d.national.running, 0);
});

test('a feed answer that is not GTFS-Realtime fails, so the last good copy is kept', async t => {
    await assert.rejects(run(t, { Vehicles: { message: 'Quota exceeded' }, TripUpdates: updates }), /Vehicles answer not recognised/);
    await assert.rejects(run(t, { Vehicles: vehicles, TripUpdates: { header, entity: 'none' } }), /TripUpdates answer not recognised/);
});
