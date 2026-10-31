// Census 2022 profile of each county from the CSO: age, Irish speakers and how people get to work.
// Council areas are combined into counties (Dublin's four, Cork, Galway, Limerick and Waterford).
const { fetchCso, cube } = require('../lib/jsonstat');
const { countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'CSO Census 2022 (F1020, FY095, F7065)',
    url: 'https://data.cso.ie/',
    licence: 'CC BY 4.0'
};

const both = l => /both sexes/i.test(l);
const pct = (part, whole) => whole ? Number((100 * part / whole).toFixed(1)) : null;

/** Add a value into counties[id][key], for every council/area code in a dimension. */
function byCounty(dim, fn) {
    const out = {};
    for (const code of dim.index) {
        const id = countyFromName(dim.label[code]);
        if (id) fn(id, code, out);
    }
    return out;
}

async function ages(counties) {
    const c = cube(await fetchCso('F1020'));
    const area = c.dim('C03789');
    const age = c.dim('C02076');
    const base = { STATISTIC: () => true, [c.dim('TLIST').id]: () => true, [c.dim('C02199').id]: both };
    const v = (a, g) => c.value({ ...base, [area.id]: a, [age.id]: g }) || 0;
    const groups = age.index.filter(g => !/^all ages$/i.test(age.label[g]));
    const under15 = groups.filter(g => /^(0 - 4|5 - 9|10 - 14) years$/.test(age.label[g]));
    const over65 = groups.filter(g => /^(65|70|75|80|85)/.test(age.label[g]));
    const all = age.index.find(g => /^all ages$/i.test(age.label[g]));
    const sums = byCounty(area, (id, a, out) => {
        const s = out[id] || (out[id] = { all: 0, under15: 0, over65: 0, aged3plus: 0 });
        s.all += v(a, all);
        // Irish-speaking figures cover people aged 3 and over: drop ages 0–2, about 3/5 of the 0–4 group
        s.aged3plus += v(a, all) - 0.6 * v(a, age.index.find(g => /^0 - 4 years$/.test(age.label[g])));
        s.under15 += under15.reduce((t, g) => t + v(a, g), 0);
        s.over65 += over65.reduce((t, g) => t + v(a, g), 0);
    });
    for (const [id, s] of Object.entries(sums)) {
        const e = counties[id] || (counties[id] = {});
        e.under15 = pct(s.under15, s.all);
        e.over65 = pct(s.over65, s.all);
        e.aged3plus = Math.round(s.aged3plus);
    }
}

async function irish(counties) {
    const c = cube(await fetchCso('FY095'));
    const area = c.dim('C03789');
    const level = c.dim('C04105');
    const base = { [c.dim('TLIST').id]: () => true, [c.dim('C02199').id]: both, [c.dim('C02076').id]: l => /^all ages$/i.test(l) };
    const count = (a, l) => c.value({ ...base, STATISTIC: lab => /total population/i.test(lab), [area.id]: a, [level.id]: l }) || 0;
    const total = level.index.find(l => /total/i.test(level.label[l]));
    const veryWellOrWell = level.index.filter(l => /very well|- well$/i.test(level.label[l]));
    // Counts of speakers; shares are of everyone aged 3+ (from the age table, so run ages() first)
    const sums = byCounty(area, (id, a, out) => {
        const s = out[id] || (out[id] = { speakers: 0, well: 0 });
        s.speakers += count(a, total);
        s.well += veryWellOrWell.reduce((t, l) => t + count(a, l), 0);
    });
    for (const [id, s] of Object.entries(sums)) {
        const e = counties[id] || (counties[id] = {});
        e.irishSpeakers = pct(s.speakers, e.aged3plus);
        e.irishWell = pct(s.well, e.aged3plus);
    }
}

async function commuting(counties) {
    const c = cube(await fetchCso('F7065'));
    const area = c.dim('C04104');
    const mode = c.dim('C02734');
    const base = {
        STATISTIC: l => /^population aged 15 years and over at work$/i.test(l),
        [c.dim('TLIST').id]: () => true,
        [c.dim('C02199').id]: both
    };
    const v = (a, m) => c.value({ ...base, [area.id]: a, [mode.id]: m }) || 0;
    const find = re => mode.index.filter(m => re.test(mode.label[m]));
    const modes = { car: find(/^motor car/i), publicTransport: find(/^(bus|train)/i), active: find(/^(on foot|bicycle)/i), all: find(/^all means/i) };
    const sums = byCounty(area, (id, a, out) => {
        const s = out[id] || (out[id] = { car: 0, publicTransport: 0, active: 0, all: 0 });
        for (const [k, codes] of Object.entries(modes)) s[k] += codes.reduce((t, m) => t + v(a, m), 0);
    });
    for (const [id, s] of Object.entries(sums)) {
        const e = counties[id] || (counties[id] = {});
        e.commuteCar = pct(s.car, s.all);
        e.commutePublic = pct(s.publicTransport, s.all);
        e.commuteActive = pct(s.active, s.all);
    }
}

async function fetchCensus() {
    const counties = {};
    await ages(counties);
    await irish(counties);
    await commuting(counties);
    return { updatedAt: new Date().toISOString(), source: SOURCE, census: 2022, censusDate: '2022-04-03', counties };
}

module.exports = { fetchCensus };
