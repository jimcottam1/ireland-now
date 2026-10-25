// Irish Rail: trains running right now, with where they are and how late.
const { getText } = require('../lib/http');
const { countyAt } = require('../lib/geo');

const SOURCE = {
    name: 'Irish Rail realtime API',
    url: 'https://api.irishrail.ie/realtime/',
    licence: 'Irish Rail open data'
};

const tag = (block, name) => (block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || '';

async function fetchTrains() {
    const xml = await getText('http://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML');
    const blocks = xml.match(/<objTrainPositions>[\s\S]*?<\/objTrainPositions>/g) || [];

    const trains = blocks.map(block => {
        // PublicMessage looks like "A123\n14:05 - Cork to Dublin Heuston (5 mins late)\nArrived Thurles next stop..."
        const message = tag(block, 'PublicMessage').replace(/\\n/g, '\n');
        const lines = message.split('\n').map(s => s.trim()).filter(Boolean);
        const late = message.match(/\((-?\d+) mins? late\)/);
        return {
            code: tag(block, 'TrainCode'),
            status: tag(block, 'TrainStatus'), // R = running, N = not yet running, T = terminated
            lat: parseFloat(tag(block, 'TrainLatitude')),
            lon: parseFloat(tag(block, 'TrainLongitude')),
            direction: tag(block, 'Direction'),
            route: (lines[1] || '').replace(/\s*\(-?\d+ mins? late\)/, '').replace(/^\d{2}:\d{2}\s*-\s*/, ''),
            progress: lines[2] || '',
            minutesLate: late ? parseInt(late[1], 10) : null
        };
    })
        .filter(t => t.status === 'R' && Number.isFinite(t.lat) && t.lat !== 0)
        .map(t => ({ ...t, county: countyAt(t.lon, t.lat) }));

    const late = trains.filter(t => t.minutesLate >= 5);
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        trains,
        national: {
            running: trains.length,
            late: late.length,
            averageDelay: trains.length ? Number((trains.reduce((s, t) => s + Math.max(0, t.minutesLate || 0), 0) / trains.length).toFixed(1)) : 0
        }
    };
}

module.exports = { fetchTrains };
