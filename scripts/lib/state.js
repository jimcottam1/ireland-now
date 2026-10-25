// Small persistent state between runs (restored from the GitHub Actions cache): river level history,
// slow-changing layers that only need refreshing daily, and the last good copy of every layer.
const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..', '..', 'state');

function read(name, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${name}.json`), 'utf8'));
    } catch {
        return fallback;
    }
}

function write(name, value) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, `${name}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
}

/** Reuse a stored result while it's younger than maxAgeHours; otherwise rebuild it. */
async function cached(name, maxAgeHours, build) {
    const stored = read(`cache-${name}`);
    if (stored && Date.now() - new Date(stored.updatedAt).getTime() < maxAgeHours * 3600000) {
        return { ...stored, fromCache: true };
    }
    const fresh = await build();
    write(`cache-${name}`, fresh);
    return fresh;
}

module.exports = { read, write, cached };
