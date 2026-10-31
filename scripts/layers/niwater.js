// NI Water current service updates (supply interruptions, planned work) for Northern Ireland.
// NI Water has no data feed, but lists every incident on its service updates page with a map
// position, so this reads that page (its robots.txt allows it). Shaped like the Uisce Éireann
// notices so the map and panels can show both together.
const { getText } = require('../lib/http');
const { dublinToIso } = require('../lib/time');
const { countyAt } = require('../lib/geo');

const SOURCE = {
    name: 'NI Water current service updates',
    url: 'https://www.niwater.com/whats-happening-in-your-area/current-service-updates',
    licence: 'NI Water public information'
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// NI Water's categories -> the kinds used for Uisce Éireann notices
const KINDS = {
    'water-supply-interruption': 'outage',
    'potential-supply-interruption': 'outage',
    'restriction-to-supply': 'restrictions',
    'alternative-water-supply': 'outage',
    'planned-maintenance': 'works',
    'boil-water-notice': 'boil-water',
    'do-not-drink': 'do-not-drink'
};

/** "31 October 2026 22:20" (Northern Ireland time, same clock as Ireland) -> ISO */
function niTime(text) {
    const m = String(text || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return month ? dublinToIso(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5])) : null;
}

const clean = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

async function fetchNiWater() {
    const html = await getText(SOURCE.url, { timeoutMs: 60000 });
    const blocks = html.split(/<div class="site grid-item /).slice(1);

    const notices = blocks.map(block => {
        const attr = name => (block.match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1] || '';
        const [lat, lon] = ((block.match(/<li>\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*<\/li>/) || []).slice(1)).map(Number);
        const category = attr('category');
        const title = clean((block.match(/<h3 class="title">([\s\S]*?)<\/h3>/) || [])[1]);
        const heading = clean((block.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1]);
        const updated = niTime((block.match(/Last\s+updated:\s*([^<]+)</i) || [])[1]);
        const restore = niTime((block.match(/restoration time:\s*([^<]+)</i) || [])[1]);
        const description = clean((block.match(/<div class="content">\s*<p>NI Water([\s\S]*?)<\/p>/) || [])[0] || '').slice(0, 600);
        return {
            id: `niw-${attr('event-id')}`,
            title: title ? `${heading}: ${title}` : heading,
            kind: KINDS[category] || 'works',
            planned: category === 'planned-maintenance',
            active: !/upcoming|future|planned/i.test(attr('event-status')),
            start: updated,
            end: restore,
            updated,
            description,
            reference: attr('event-id') || null,
            lat: Number.isFinite(lat) ? Number(lat.toFixed(5)) : null,
            lon: Number.isFinite(lon) ? Number(lon.toFixed(5)) : null,
            county: Number.isFinite(lon) ? countyAt(lon, lat) : null,
            issuer: 'NI Water',
            url: SOURCE.url
        };
    }).filter(n => n.title);

    // The page says "no incidents" in words when it's quiet, so an empty list is fine; a page with no
    // incident blocks *and* no service-updates heading means the layout changed
    if (!notices.length && !/current service updates/i.test(html)) throw new Error('NI Water page layout not recognised');

    const counties = {};
    for (const n of notices) {
        if (!n.county) continue;
        const c = counties[n.county] || (counties[n.county] = { active: 0, upcoming: 0, boilWater: 0, doNotDrink: 0 });
        if (n.active) c.active++; else c.upcoming++;
        if (n.kind === 'boil-water') c.boilWater++;
        if (n.kind === 'do-not-drink') c.doNotDrink++;
    }

    // Newest "last updated" time on the page: how current NI Water's list is
    const sourceTime = notices.reduce((max, n) => (n.updated && n.updated > (max || '') ? n.updated : max), null);
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime, notices, counties };
}

module.exports = { fetchNiWater };
