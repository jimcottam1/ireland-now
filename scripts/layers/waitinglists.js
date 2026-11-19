// NTPF hospital waiting lists: people waiting for a first outpatient appointment, and for an inpatient or
// day-case procedure, at each public hospital, published monthly.
//
// The open data page (https://www.ntpf.ie/waiting-list-data/open-data/) links one CSV per list per year
// (OpenData_OPNational01_2026.csv, OpenData_IPDCNational01_2026.csv), each holding a row per hospital,
// adult or child, for every month so far that year. The upload folder in the link changes as files are
// replaced, so the links are read from the page. NTPF allows re-use under the PSI regulations with credit.
const { getText } = require('../lib/http');
const { csvObjects } = require('../lib/csv');

const SOURCE = {
    name: 'National Treatment Purchase Fund waiting lists',
    url: 'https://www.ntpf.ie/waiting-list-data/open-data/',
    licence: 'Re-use of Public Sector Information (© NTPF)',
    licenceUrl: 'https://www.ntpf.ie/information-re-use/'
};

const PAGE = 'https://www.ntpf.ie/waiting-list-data/open-data/';
const LISTS = { outpatients: 'OPNational01', inpatients: 'IPDCNational01' };
const BANDS = ['0-6 Months', '6-12 Months', '12-18 Months', '18 Months +', 'Total'];
// Sanity limits on the national totals: well outside what Ireland has seen, either way
const LIMITS = { outpatients: [200000, 2000000], inpatients: [20000, 400000] };
const MAX_UNKNOWN = 3;   // a new hospital or two is shown nationally only; more means the names changed

// Hospital name as the NTPF files write it -> county
const HOSPITALS = {
    'Bantry General Hospital': 'cork',
    'Beaumont Hospital': 'dublin',
    'Cavan General Hospital': 'cavan',
    "Children's Health Ireland": 'dublin',
    'Connolly Hospital Blanchardstown': 'dublin',
    'Coombe Women and Infants University Hospital': 'dublin',
    'Cork University Hospital': 'cork',
    'Cork University Maternity Hospital': 'cork',
    'Croom Orthopaedic Hospital': 'limerick',
    'Ennis Hospital': 'clare',
    'Galway University Hospitals': 'galway',
    'Kilcreene Regional Orthopaedic Hospital': 'kilkenny',
    'Letterkenny University Hospital': 'donegal',
    'Louth County Hospital': 'louth',
    'Mallow General Hospital': 'cork',
    'Mater Misericordiae University Hospital': 'dublin',
    'Mayo University Hospital': 'mayo',
    'Mercy University Hospital': 'cork',
    'Midland Regional Hospital Mullingar': 'westmeath',
    'Midland Regional Hospital Portlaoise': 'laois',
    'Midland Regional Hospital Tullamore': 'offaly',
    'Naas General Hospital': 'kildare',
    'National Maternity Hospital (Holles Street)': 'dublin',
    'National Orthopaedic Hospital Cappagh': 'dublin',
    'Nenagh Hospital': 'tipperary',
    'North Dublin Surgical Hub': 'dublin',
    'Our Lady of Lourdes Hospital Drogheda': 'louth',
    "Our Lady's Hospital Navan": 'meath',
    'Portiuncula University Hospital': 'galway',
    'Roscommon University Hospital': 'roscommon',
    'Rotunda Hospital': 'dublin',
    'Royal Victoria Eye and Ear Hospital': 'dublin',
    'Sligo University Hospital': 'sligo',
    'South Infirmary Victoria University Hospital': 'cork',
    "St. Columcille's Hospital": 'dublin',
    "St. James's Hospital": 'dublin',
    "St. John's Hospital Limerick": 'limerick',
    "St. Luke's General Hospital Kilkenny": 'kilkenny',
    "St. Michael's Hospital": 'dublin',   // Dún Laoghaire
    "St. Vincent's University Hospital": 'dublin',
    'Tallaght University Hospital': 'dublin',
    'Tipperary University Hospital': 'tipperary',
    'University Hospital Kerry': 'kerry',
    'University Hospital Limerick': 'limerick',
    'University Hospital Waterford': 'waterford',
    'Wexford General Hospital': 'wexford'
};

/** { year: url } for one list's CSVs on the open data page. */
function linksFor(html, code) {
    const links = {};
    const pattern = new RegExp(`https://www\\.ntpf\\.ie/app/uploads/\\d{4}/\\d{2}/OpenData_${code}_(\\d{4})(?:-\\d+)?\\.csv`, 'g');
    for (const m of html.matchAll(pattern)) {
        // A year can be uploaded more than once; the newest upload folder wins
        if (!links[m[1]] || m[0] > links[m[1]]) links[m[1]] = m[0];
    }
    return links;
}

const number = (text, where) => {
    const clean = String(text).replace(/,/g, '');
    if (!/^\d+$/.test(clean)) throw new Error(`Waiting lists: "${text}" is not a number (${where})`);
    return Number(clean);
};

/** "29/10/2026" -> "2026-10-29" */
function isoDate(text) {
    const m = String(text).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) throw new Error(`Waiting lists: "${text}" is not a date`);
    return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Every month in one CSV: { 'YYYY-MM-DD': { hospital: { total, long } } }, adults and children added together. */
function parse(text, label) {
    const rows = csvObjects(text, ['ArchiveDate', 'Adult_Child', 'HospitalName', ...BANDS]);
    if (!rows.length) throw new Error(`Waiting lists: the ${label} file has no rows`);
    const months = {};
    for (const r of rows) {
        const date = isoDate(r.ArchiveDate);
        const name = r.HospitalName;
        if (!name) throw new Error(`Waiting lists: a ${label} row has no hospital`);
        const where = `${label}, ${name}, ${r.ArchiveDate}`;
        const [b1, b2, b3, b4, total] = BANDS.map(b => number(r[b], where));
        // NTPF's own bands are often one or two out from its total; a bigger gap means a column moved
        if (Math.abs(b1 + b2 + b3 + b4 - total) > Math.max(5, total * 0.005)) {
            throw new Error(`Waiting lists: the time bands don't add up to the total (${where})`);
        }
        const h = ((months[date] ||= {})[name] ||= { total: 0, long: 0 });
        h.total += total;
        h.long += b3 + b4;
    }
    return months;
}

const sum = (hospitals, key) => Object.values(hospitals).reduce((s, h) => s + h[key], 0);
const change = (now, before) => before ? Number((100 * (now - before) / before).toFixed(1)) : null;

/** The same month a year earlier from a set of months, if there is one (dates within a fortnight). */
function yearEarlier(months, date) {
    const target = Date.parse(`${Number(date.slice(0, 4)) - 1}${date.slice(4)}T12:00:00Z`);
    return Object.entries(months).find(([d]) => Math.abs(Date.parse(`${d}T12:00:00Z`) - target) < 15 * 86400000)?.[1] || null;
}

async function fetchWaitingLists() {
    const html = await getText(PAGE);
    const lists = {};
    for (const [key, code] of Object.entries(LISTS)) {
        const links = linksFor(html, code);
        const years = Object.keys(links).sort();
        if (!years.length) throw new Error(`Waiting lists: no ${code} files on the open data page`);
        const newest = years[years.length - 1];
        const months = parse(await getText(links[newest]), key);
        const latest = Object.keys(months).sort().pop();

        // A year earlier comes from the same file (or last year's); optional
        let before = yearEarlier(months, latest);
        const lastYear = String(Number(latest.slice(0, 4)) - 1);
        if (!before && links[lastYear]) {
            try {
                before = yearEarlier(parse(await getText(links[lastYear]), key), latest);
            } catch (error) {
                console.warn(`   Waiting lists: no year-earlier ${key} figures (${error.message})`);
            }
        }
        lists[key] = { date: latest, now: months[latest], before };
    }

    // Both lists are archived on the same day each month
    const date = lists.outpatients.date;
    if (lists.inpatients.date !== date) {
        throw new Error(`Waiting lists: the outpatient (${date}) and inpatient (${lists.inpatients.date}) files are for different days`);
    }

    const names = [...new Set(Object.values(lists).flatMap(l => Object.keys(l.now)))].sort();
    const unknown = names.filter(n => !HOSPITALS[n]);
    if (unknown.length > MAX_UNKNOWN) throw new Error(`Waiting lists: ${unknown.length} hospitals not recognised (${unknown.join(', ')})`);
    for (const n of unknown) console.warn(`   Waiting lists: "${n}" has no county; counted nationally only`);

    const national = {};
    for (const [key, l] of Object.entries(lists)) {
        national[key] = sum(l.now, 'total');
        national[`${key}Long`] = sum(l.now, 'long');
        national[`${key}Change`] = l.before ? change(national[key], sum(l.before, 'total')) : null;
        const [low, high] = LIMITS[key];
        if (national[key] < low || national[key] > high) throw new Error(`Waiting lists: ${national[key]} ${key} nationally is not believable`);
    }

    const hospitals = names.map(name => ({
        name,
        county: HOSPITALS[name] || null,
        outpatients: lists.outpatients.now[name]?.total ?? 0,
        outpatientsLong: lists.outpatients.now[name]?.long ?? 0,
        inpatients: lists.inpatients.now[name]?.total ?? 0,
        inpatientsLong: lists.inpatients.now[name]?.long ?? 0
    }));

    const counties = {};
    for (const h of hospitals.filter(x => x.county)) {
        const c = (counties[h.county] ||= { hospitals: 0, outpatients: 0, outpatientsLong: 0, inpatients: 0, inpatientsLong: 0 });
        c.hospitals++;
        for (const key of ['outpatients', 'outpatientsLong', 'inpatients', 'inpatientsLong']) c[key] += h[key];
    }

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        date,
        hospitals,
        counties,
        national
    };
}

module.exports = { fetchWaitingLists };
