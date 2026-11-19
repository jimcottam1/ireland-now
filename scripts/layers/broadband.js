// Census 2022: households with a broadband connection, by county (CSO table SAP2022T15T2CTY, CC BY 4.0).
// The table is by council area; Dublin's four, Cork's two and Galway's two are added together.
// The share is of households that answered the question ("not stated" is left out of both sides).
const { fetchCso, cube } = require('../lib/jsonstat');
const { countyFromName, ROI_IDS } = require('../lib/geo');

const SOURCE = {
    name: 'CSO Census 2022 (SAP2022T15T2CTY)',
    url: 'https://data.cso.ie/table/SAP2022T15T2CTY',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const TABLE = 'SAP2022T15T2CTY';
const KINDS = { broadband: /^broadband$/i, other: /^other$/i, none: /^no$/i, notStated: /^not stated$/i };

const share = (part, whole) => whole ? Number((100 * part / whole).toFixed(1)) : null;

async function fetchBroadband() {
    const c = cube(await fetchCso(TABLE));
    const kind = c.dim('C03764');
    const area = c.dim('C03789');
    const year = c.dim('TLIST');
    if (!kind || !area || !year) throw new Error('Broadband: the CSO table layout changed');
    const codes = Object.fromEntries(Object.entries(KINDS).map(([key, pattern]) => [key, kind.index.find(k => pattern.test(kind.label[k]))]));
    const missing = Object.keys(KINDS).filter(k => !codes[k]);
    if (missing.length) throw new Error(`Broadband: the table has no ${missing.join(', ')} column`);

    const value = (a, k) => {
        const v = c.value({ STATISTIC: () => true, [year.id]: () => true, [kind.id]: codes[k], [area.id]: a });
        if (!Number.isFinite(v) || v < 0) throw new Error(`Broadband: no ${k} figure for ${area.label[a]}`);
        return v;
    };

    const sums = {};
    let national = null;
    for (const a of area.index) {
        const row = Object.fromEntries(Object.keys(KINDS).map(k => [k, value(a, k)]));
        if (/^(ireland|state)$/i.test(area.label[a].trim())) { national = row; continue; }
        const id = countyFromName(area.label[a]);
        if (!ROI_IDS.includes(id)) throw new Error(`Broadband: "${area.label[a]}" is not a county`);
        const s = (sums[id] ||= { broadband: 0, other: 0, none: 0, notStated: 0 });
        for (const k of Object.keys(KINDS)) s[k] += row[k];
    }
    const absent = ROI_IDS.filter(id => !sums[id]);
    if (absent.length) throw new Error(`Broadband: no figures for ${absent.join(', ')}`);

    const counties = {};
    for (const [id, s] of Object.entries(sums)) {
        const answered = s.broadband + s.other + s.none;
        counties[id] = { households: answered + s.notStated, broadband: share(s.broadband, answered), none: share(s.none, answered) };
    }
    const nAnswered = national ? national.broadband + national.other + national.none : 0;

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        census: '2022-04-03',
        counties,
        national: national ? { broadband: share(national.broadband, nAnswered), none: share(national.none, nAnswered) } : null
    };
}

module.exports = { fetchBroadband };
