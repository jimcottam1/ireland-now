// Keep API keys out of anything we publish (status.json) or post (GitHub issues).
// Error messages can quote a URL or a response body, and some keys travel in the query string.
const KEY_NAMES = ['NTA_API_KEY', 'JCDECAUX_API_KEY', 'LOGAINM_API_KEY', 'WINDY_API_KEY'];

function redact(text) {
    let out = String(text ?? '');
    for (const name of KEY_NAMES) {
        const value = process.env[name];
        if (!value) continue;
        for (const form of new Set([value, encodeURIComponent(value)])) out = out.split(form).join('***');
    }
    // Belt and braces: any query-string style key value, whatever its source
    return out.replace(/\b(api[_-]?key|key|token|apikey)=[^\s&"'<>]+/gi, '$1=***');
}

/** The message of an error with its cause chain, redacted. */
function redactedMessage(error) {
    const parts = [];
    for (let e = error, n = 0; e && n < 4; e = e.cause, n++) parts.push(e.message || String(e));
    return redact(parts.join(': '));
}

module.exports = { redact, redactedMessage };
