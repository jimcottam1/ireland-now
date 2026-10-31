// CSO headline figures: unemployment, inflation and new homes nationally; the Live Register and new
// home completions for each county.
const { fetchCso, cube } = require('../lib/jsonstat');
const { countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'CSO PxStat (MUM01, CPM20, NDM01, LRM15, NDQ05)',
    url: 'https://data.cso.ie/',
    licence: 'CC BY 4.0'
};

const both = label => /both sexes/i.test(label);
/** Codes of a time dimension, oldest first, keeping only periods that have a value. */
const periods = (c, dimId, pick) => {
    const dim = c.dim(dimId);
    return dim.index.filter(code => c.value({ ...pick, [dim.id]: code }) != null).map(code => ({ code, label: dim.label[code] }));
};

async function unemployment() {
    const c = cube(await fetchCso('MUM01'));
    const pick = {
        STATISTIC: label => /rate/i.test(label),
        [c.dim('C02076').id]: label => /15 - 74/.test(label),
        [c.dim('C02199').id]: both
    };
    const months = periods(c, 'TLIST', pick);
    const last = months[months.length - 1];
    const yearAgo = months[months.length - 13];
    const at = m => c.value({ ...pick, [c.dim('TLIST').id]: m.code });
    return { rate: at(last), month: last.label, yearAgo: yearAgo ? at(yearAgo) : null };
}

async function inflation() {
    const c = cube(await fetchCso('CPM20'));
    const pick = { STATISTIC: label => /12 months/i.test(label), [c.dim('C04624').id]: label => /^all items$/i.test(label) };
    const months = periods(c, 'TLIST', pick);
    const last = months[months.length - 1];
    return { annual: c.value({ ...pick, [c.dim('TLIST').id]: last.code }), month: last.label };
}

async function newHomesNational() {
    const c = cube(await fetchCso('NDM01'));
    const pick = { STATISTIC: () => true, [c.dim('C02342').id]: label => /all/i.test(label) };
    const months = periods(c, 'TLIST', pick);
    const at = m => c.value({ ...pick, [c.dim('TLIST').id]: m.code });
    const last12 = months.slice(-12).reduce((s, m) => s + at(m), 0);
    const prior12 = months.slice(-24, -12).reduce((s, m) => s + at(m), 0);
    const last = months[months.length - 1];
    return { month: last.label, monthCount: at(last), last12, change: prior12 ? Number((100 * (last12 - prior12) / prior12).toFixed(1)) : null };
}

async function liveRegister(counties) {
    const c = cube(await fetchCso('LRM15'));
    const countyDim = c.dim('C03788');
    const pick = { STATISTIC: () => true, [c.dim('C02076').id]: label => /all ages/i.test(label), [c.dim('C02199').id]: both };
    const time = c.dim('TLIST');
    const months = periods(c, 'TLIST', { ...pick, [countyDim.id]: label => /ireland/i.test(label) });
    const last = months[months.length - 1];
    const yearAgo = months[months.length - 13];
    for (const code of countyDim.index) {
        const id = countyFromName(countyDim.label[code]);
        if (!id) continue;
        const now = c.value({ ...pick, [countyDim.id]: code, [time.id]: last.code });
        const before = yearAgo ? c.value({ ...pick, [countyDim.id]: code, [time.id]: yearAgo.code }) : null;
        const entry = counties[id] || (counties[id] = {});
        entry.liveRegister = now;
        entry.liveRegisterChange = before ? Number((100 * (now - before) / before).toFixed(1)) : null;
    }
    return last.label;
}

async function newHomesByCounty(counties) {
    const c = cube(await fetchCso('NDQ05'));
    const la = c.dim('C03789');
    const time = c.dim('TLIST');
    const pick = { STATISTIC: () => true };
    const quarters = periods(c, 'TLIST', { ...pick, [la.id]: label => /ireland/i.test(label) }).slice(-4);
    for (const code of la.index) {
        // Councils: Dublin's four, Cork City and County, Galway City and County are combined
        const id = countyFromName(la.label[code]);
        if (!id) continue;
        const total = quarters.reduce((s, q) => s + (c.value({ ...pick, [la.id]: code, [time.id]: q.code }) || 0), 0);
        const entry = counties[id] || (counties[id] = {});
        entry.newHomes = (entry.newHomes || 0) + total;
    }
    return `${quarters[0].label} to ${quarters[quarters.length - 1].label}`;
}

async function fetchEconomy() {
    const counties = {};
    // One at a time: the CSO API is slow, and these are only refreshed daily
    const unemp = await unemployment();
    const cpi = await inflation();
    const homes = await newHomesNational();
    const liveRegisterMonth = await liveRegister(counties);
    const newHomesPeriod = await newHomesByCounty(counties);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        national: { unemployment: unemp, inflation: cpi, newHomes: homes },
        liveRegisterMonth,
        newHomesPeriod,
        counties
    };
}

module.exports = { fetchEconomy };
