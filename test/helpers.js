// Test helpers: answer the layers' web requests from saved files, so tests never touch the network,
// and keep each test file's state (river and weather history) in its own temporary folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ireland-now-test-'));

const http = require('../scripts/lib/http');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

/**
 * Route requests to canned answers: routes = [[/url pattern/, body or (url) => body], ...].
 * A body can be a string, a Buffer or an object (served as JSON). An unmatched URL fails the test.
 */
function mockHttp(routes) {
    const answer = url => {
        const route = routes.find(([pattern]) => pattern.test(url));
        if (!route) throw new Error(`No fixture for ${url}`);
        return typeof route[1] === 'function' ? route[1](url) : route[1];
    };
    const asText = body => (Buffer.isBuffer(body) || typeof body === 'string' ? String(body) : JSON.stringify(body));
    http.getText = async url => asText(answer(url));
    http.getJson = async url => { const b = answer(url); return Buffer.isBuffer(b) || typeof b === 'string' ? JSON.parse(b) : b; };
    http.getBuffer = async url => Buffer.from(answer(url));
    http.get = async url => { throw new Error(`Unmocked raw request to ${url}`); };
}

/** Load a layer fresh, after mockHttp, so the http functions it captures are the fakes. */
function loadLayer(name) {
    const file = require.resolve(`../scripts/layers/${name}`);
    delete require.cache[file];
    return require(file);
}

module.exports = { fixture, mockHttp, loadLayer };
