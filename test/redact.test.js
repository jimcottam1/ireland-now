// API keys must never reach status.json (published) or a GitHub issue, whatever the error looks like.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { redact, redactedMessage } = require('../scripts/lib/redact');
// The real http functions, copied before any mockHttp replaces them
const realHttp = { ...require('../scripts/lib/http') };

const KEY = 'fake-key+/abc=123';
const URL_WITH_KEY = `https://api.jcdecaux.com/vls/v1/stations?contract=dublin&apiKey=${encodeURIComponent(KEY)}`;

function withEnv(fn) {
    return async t => {
        const saved = { ...process.env };
        process.env.JCDECAUX_API_KEY = KEY;
        process.env.NTA_API_KEY = 'nta-secret-777';
        try { await fn(t); } finally { for (const k of ['JCDECAUX_API_KEY', 'NTA_API_KEY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
    };
}
const assertClean = text => {
    for (const secret of [KEY, encodeURIComponent(KEY), 'nta-secret-777']) assert.ok(!text.includes(secret), `leaked ${secret} in: ${text}`);
    assert.ok(!/apiKey=[^*]/.test(text), text);
};

// Run a real http call against a fake fetch and return what runLayer would publish
async function failure(fakeFetch, url = URL_WITH_KEY) {
    const realFetch = global.fetch;
    global.fetch = fakeFetch;
    try {
        const error = await realHttp.getJson(url, { retries: 0 }).then(() => assert.fail('should reject'), e => e);
        return redactedMessage(error);
    } finally { global.fetch = realFetch; }
}

test('a network failure whose cause quotes the URL', withEnv(async () => {
    const msg = await failure(async () => { throw new TypeError('fetch failed', { cause: new Error(`connect failed ${URL_WITH_KEY}`) }); });
    assert.match(msg, /connect failed/, 'the useful part of the message is kept');
    assertClean(msg);
}));

test('a timeout error', withEnv(async () => {
    assertClean(await failure(async () => { throw new DOMException(`The operation timed out: ${URL_WITH_KEY}`, 'TimeoutError'); }));
}));

test('a 200 whose body is not JSON and echoes the key', withEnv(async () => {
    assertClean(await failure(async () => ({ ok: true, status: 200, json: async () => JSON.parse(`leak ${KEY}`) })));
    assertClean(await failure(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token 'l', "leak ${KEY}" is not valid JSON`); } })));
}));

test('a malformed URL (Failed to parse URL)', withEnv(async () => {
    assertClean(redactedMessage(new TypeError(`Failed to parse URL from https://api.jcdecaux.com:bad/stations?apiKey=${KEY}`)));
    assertClean(redactedMessage(new TypeError(`Failed to parse URL from https://x.test/?apiKey=${encodeURIComponent(KEY)}`)));
}));

test('query-string keys are redacted even when not in the environment', () => {
    assert.equal(redact('GET https://x.test/a?apiKey=SECRET&b=1 failed'), 'GET https://x.test/a?apiKey=***&b=1 failed');
    assert.equal(redact('no key here'), 'no key here');
});

test('empty key values do not blank the message', () => {
    const saved = process.env.LOGAINM_API_KEY;
    process.env.LOGAINM_API_KEY = '';
    try { assert.equal(redact('hello'), 'hello'); } finally { if (saved === undefined) delete process.env.LOGAINM_API_KEY; else process.env.LOGAINM_API_KEY = saved; }
});

test('build.js and check-sources.js both redact before publishing', () => {
    const read = f => fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');
    assert.match(read('build.js'), /const message = redactedMessage\(error\)/);
    assert.match(read('build.js'), /error: message/);
    assert.match(read('check-sources.js'), /redact\(s\.error/);
});
