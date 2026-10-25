// Polite fetching: identify ourselves, time out, and retry transient failures a couple of times.
const USER_AGENT = 'IrelandNow/1.0 (+https://jimcottam1.github.io/ireland-now/)';

async function get(url, { timeoutMs = 30000, retries = 2, headers = {} } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, ...headers },
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
            return res;
        } catch (error) {
            lastError = error;
            // Client errors won't fix themselves on a retry
            if (/HTTP 4\d\d/.test(error.message)) break;
            if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
    throw lastError;
}

const getJson = async (url, options) => (await get(url, options)).json();
const getText = async (url, options) => (await get(url, options)).text();
const getBuffer = async (url, options) => Buffer.from(await (await get(url, options)).arrayBuffer());

module.exports = { get, getJson, getText, getBuffer };
