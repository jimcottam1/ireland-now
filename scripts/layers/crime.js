// Recorded crime by Garda division (CSO table CJQ10, the Garda operating model divisions), last four
// quarters against the four before. Divisions cover one to three counties, and Dublin is split into
// six, so each county shows the division(s) it belongs to.
// The CSO publishes these figures "under reservation" because of concerns about how crime is recorded.
const { fetchCso, cube } = require('../lib/jsonstat');
const { countiesInName } = require('../lib/geo');

const SOURCE = {
    name: 'CSO Recorded Crime (CJQ10), under reservation',
    url: 'https://data.cso.ie/table/CJQ10',
    licence: 'CC BY 4.0'
};

// Headline offence groups, by the code the CSO puts in brackets after each name
const GROUPS = {
    '03': 'assaults',
    '07': 'burglary',
    '08': 'theft',
    '10': 'drugs',
    '12': 'damage',
    '13': 'publicOrder'
};

/** "Louth/Cavan/Monaghan Garda Division" -> ['louth', 'cavan', 'monaghan']; Dublin's six D.M.R. divisions -> ['dublin']. */
function divisionCounties(label) {
    if (/D\.M\.R\./.test(label)) return ['dublin'];
    return countiesInName(label.replace(/Garda Division/i, '').replace(/\//g, ' '));
}

async function fetchCrime() {
    const raw = await fetchCso('CJQ10');
    const c = cube(raw);
    const time = c.dim('TLIST');
    const div = c.dim('C02481');
    const off = c.dim('C02480');

    // Top-level offence groups have two-digit codes, e.g. "Theft and related offences (08)"
    const topLevel = off.index.filter(k => /\(\d{2}\)$/.test(off.label[k]));
    const groupCode = k => off.label[k].match(/\((\d{2})\)$/)[1];

    const quarters = time.index.filter(q => c.value({ STATISTIC: () => true, [time.id]: q, [div.id]: div.index[0], [off.id]: topLevel[0] }) != null);
    const last4 = quarters.slice(-4);
    if (!last4.length) throw new Error('CJQ10: no quarter has any recorded crime figures');
    // Year-on-year change uses only quarters whose same quarter a year earlier also has figures
    // (the current divisions only start in 2025, so early on this is fewer than four)
    const yearBefore = q => time.index[time.index.indexOf(q) - 4];
    const compared = last4.filter(q => quarters.includes(yearBefore(q)));

    const sum = (divCode, qs, offCodes) => qs.reduce((s, q) => s + offCodes.reduce((t, o) =>
        t + (c.value({ STATISTIC: () => true, [time.id]: q, [div.id]: divCode, [off.id]: o }) || 0), 0), 0);

    const divisions = div.index.map(code => {
        const label = div.label[code];
        const total = sum(code, last4, topLevel);
        const recent = sum(code, compared, topLevel);
        const before = sum(code, compared.map(yearBefore), topLevel);
        const groups = {};
        for (const o of topLevel) {
            const key = GROUPS[groupCode(o)];
            if (key) groups[key] = sum(code, last4, [o]);
        }
        return {
            name: label.replace(/ Garda Division$/i, '').replace(/^D\.M\.R\. /, 'Dublin ').replace(/\//g, ', '),
            counties: divisionCounties(label),
            total,
            change: before ? Number((100 * (recent - before) / before).toFixed(1)) : null,
            groups
        };
    });

    const unmatched = divisions.filter(d => !d.counties.length).map(d => d.name);
    if (unmatched.length) console.warn(`   Crime: no county for ${unmatched.join(', ')}`);

    const counties = {};
    divisions.forEach((d, i) => d.counties.forEach(id => (counties[id] = counties[id] || []).push(i)));

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        period: { from: time.label[last4[0]], to: time.label[last4[last4.length - 1]] },   // e.g. "2025Q3" to "2026Q2"
        // Which quarters the year-on-year change covers, e.g. "2026Q1" to "2026Q2"
        changePeriod: compared.length ? { from: time.label[compared[0]], to: time.label[compared[compared.length - 1]] } : null,
        published: raw.updated || null,
        divisions,
        counties
    };
}

module.exports = { fetchCrime };
