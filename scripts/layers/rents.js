// RTB average monthly rent for new tenancies, by county, published through the CSO (table RIQ02).
// The RTB index lags: figures for a quarter usually appear four to five months after it ends.
const { fetchCso, cube } = require('../lib/jsonstat');
const { COUNTY_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'RTB Rent Index via CSO (RIQ02)',
    url: 'https://data.cso.ie/table/RIQ02',
    licence: 'CC BY 4.0'
};

const title = id => id[0].toUpperCase() + id.slice(1);

async function fetchRents() {
    const raw = await fetchCso('RIQ02');
    const c = cube(raw);
    const time = c.dim('TLIST');
    const beds = c.dim('C02970');
    const type = c.dim('C02969');
    const loc = c.dim('C03004');
    const pick = { STATISTIC: () => true, [beds.id]: l => /^all bedrooms$/i.test(l), [type.id]: l => /^all property types$/i.test(l) };
    const at = (locCode, q) => c.value({ ...pick, [loc.id]: locCode, [time.id]: q });

    // Latest quarter that has figures for most counties
    const codeFor = name => loc.index.find(k => loc.label[k] === name);
    const quarters = time.index.filter(q => COUNTY_IDS.filter(id => at(codeFor(title(id)), q) != null).length >= 20);
    const latest = quarters[quarters.length - 1];
    const yearBefore = time.index[time.index.indexOf(latest) - 4];

    const counties = {};
    for (const id of COUNTY_IDS) {
        // The RTB names counties plainly ("Cork"); towns and city areas are listed separately
        const code = codeFor(title(id));
        const now = code && at(code, latest);
        if (now == null) continue;
        const before = yearBefore ? at(code, yearBefore) : null;
        counties[id] = {
            rent: Math.round(now),
            change: before ? Number((100 * (now - before) / before).toFixed(1)) : null,
            // Last 2 years, for a small chart
            history: time.index.slice(time.index.indexOf(latest) - 7, time.index.indexOf(latest) + 1)
                .map(q => [time.label[q], at(code, q) == null ? null : Math.round(at(code, q))])
        };
    }

    const national = codeFor('Ireland') || loc.index.find(k => /^(ireland|state|national)/i.test(loc.label[k]));
    const natNow = national ? at(national, latest) : null;
    const natBefore = national && yearBefore ? at(national, yearBefore) : null;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        quarter: time.label[latest],          // e.g. "2025Q4"
        published: raw.updated || null,       // when the CSO last updated the table
        national: natNow ? { rent: Math.round(natNow), change: natBefore ? Number((100 * (natNow - natBefore) / natBefore).toFixed(1)) : null } : null,
        counties
    };
}

module.exports = { fetchRents };
