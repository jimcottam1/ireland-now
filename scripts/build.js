// Fetch every layer and build the static site into site/.
// A layer that fails falls back to its last good copy (marked stale), so one broken source never
// takes the whole map down.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const state = require('./lib/state');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_DIR = process.env.SITE_DIR || path.join(ROOT, 'site');

// name: [fetch function, hours to reuse the last result for (0 = fetch every run)]
const LAYERS = {
    warnings: [require('./layers/warnings').fetchWarnings, 0],
    weather: [require('./layers/weather').fetchWeather, 0],
    rivers: [require('./layers/rivers').fetchRivers, 0],
    tides: [require('./layers/tides').fetchTides, 0],
    trains: [require('./layers/trains').fetchTrains, 0],
    buses: [require('./layers/buses').fetchBuses, 0],
    grid: [require('./layers/grid').fetchGrid, 0],
    water: [require('./layers/water').fetchWater, 0],
    beaches: [require('./layers/beaches').fetchBeaches, 24],
    tds: [require('./layers/tds').fetchTds, 24],
    housing: [require('./layers/housing').fetchHousing, 24],
    population: [require('./layers/population').fetchPopulation, 24 * 30]
};

async function runLayer(name, [fetchLayer, maxAgeHours]) {
    const started = Date.now();
    try {
        const data = maxAgeHours ? await state.cached(name, maxAgeHours, fetchLayer) : await fetchLayer();
        state.write(`last-${name}`, data);
        console.log(`✓ ${name}${data.fromCache ? ' (reused)' : ''} in ${Date.now() - started} ms`);
        return { data, status: { ok: true, stale: false, updatedAt: data.updatedAt } };
    } catch (error) {
        const last = state.read(`last-${name}`);
        console.error(`✗ ${name}: ${error.message}${last ? ' (using last good copy)' : ''}`);
        return {
            data: last,
            status: { ok: false, stale: Boolean(last), updatedAt: last?.updatedAt || null, error: error.message }
        };
    }
}

async function build() {
    fs.rmSync(SITE_DIR, { recursive: true, force: true });
    fs.cpSync(PUBLIC_DIR, SITE_DIR, { recursive: true });
    fs.mkdirSync(path.join(SITE_DIR, 'data'), { recursive: true });

    // GitHub Pages lets browsers cache files for 10 minutes; version the script and stylesheet by their
    // content so a returning visitor never gets a new page with old code
    const indexPath = path.join(SITE_DIR, 'index.html');
    let index = fs.readFileSync(indexPath, 'utf8');
    for (const asset of ['app.js', 'styles.css']) {
        const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, asset))).digest('hex').slice(0, 8);
        index = index.replace(`"${asset}"`, `"${asset}?v=${hash}"`);
    }
    fs.writeFileSync(indexPath, index);

    const results = await Promise.all(Object.entries(LAYERS).map(async ([name, layer]) => [name, await runLayer(name, layer)]));

    const status = { builtAt: new Date().toISOString(), layers: {} };
    for (const [name, { data, status: s }] of results) {
        status.layers[name] = s;
        if (data) {
            const { fromCache, ...clean } = data;
            fs.writeFileSync(path.join(SITE_DIR, 'data', `${name}.json`), JSON.stringify(clean));
        }
    }
    fs.writeFileSync(path.join(SITE_DIR, 'data', 'status.json'), JSON.stringify(status, null, 2));
    fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');

    const failed = Object.entries(status.layers).filter(([, s]) => !s.ok);
    console.log(`\nBuilt site: ${results.length - failed.length}/${results.length} layers fresh${failed.length ? `, failed: ${failed.map(([n]) => n).join(', ')}` : ''}`);
    if (failed.length === results.length) process.exit(1);
}

build().catch(error => {
    console.error(error);
    process.exit(1);
});
