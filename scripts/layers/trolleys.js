// HSE TrolleyGAR: patients waiting on trolleys in each hospital at 8am, from the HSE's own daily
// Urgent and Emergency Care report (published on weekdays). It's a web page rather than a data feed,
// so this reads the table and checks the totals add up before trusting it.
const { getText } = require('../lib/http');

const SOURCE = {
    name: 'HSE TrolleyGAR (Urgent and Emergency Care daily report)',
    url: 'https://uec.hse.ie/uec/TGAR.php',
    licence: 'HSE public information'
};

const URL_TGAR = 'https://uec.hse.ie/uec/TGAR.php';

// Hospital name as the report writes it -> county (matched on the start of the name)
const HOSPITALS = [
    ['Bantry', 'cork'], ['Beaumont', 'dublin'], ['CHI at', 'dublin'], ['Cavan', 'cavan'], ['Connolly', 'dublin'],
    ['Cork University', 'cork'], ['Ennis', 'clare'], ['Galway University', 'galway'], ['Letterkenny', 'donegal'],
    ['Louth County', 'louth'], ['MRH Mullingar', 'westmeath'], ['MRH Portlaoise', 'laois'], ['MRH Tullamore', 'offaly'],
    ['Mallow', 'cork'], ['Mater', 'dublin'], ['Mayo', 'mayo'], ['Mercy', 'cork'], ['Naas', 'kildare'],
    ['National Orthopaedic', 'dublin'], ['National Rehabilitation', 'dublin'], ['Nenagh', 'tipperary'],
    ['Our Lady of Lourdes', 'louth'], ["Our Lady's Hospital Navan", 'meath'], ['Portiuncula', 'galway'],
    ['Roscommon', 'roscommon'], ['Sligo', 'sligo'], ['South Infirmary', 'cork'], ["St Luke's General Hospital Kilkenny", 'kilkenny'],
    ["St. Columcille", 'dublin'], ["St. James", 'dublin'], ["St. John's Hospital Limerick", 'limerick'],
    ["St. Luke's Radiation", 'dublin'], ["St. Michael", 'dublin'], ["St. Vincent", 'dublin'], ['Tallaght', 'dublin'],
    ['Tipperary', 'tipperary'], ['UH Kerry', 'kerry'], ['UH Limerick', 'limerick'], ['UH Waterford', 'waterford'],
    ['Wexford', 'wexford']
];

const countyOf = name => HOSPITALS.find(([prefix]) => name.startsWith(prefix))?.[1] || null;
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

async function fetchTrolleys() {
    // Comments in the page hold old copies of some cells, so drop them first
    const html = (await getText(URL_TGAR, { timeoutMs: 60000 })).replace(/<!--[\s\S]*?-->/g, '');

    const heading = decode((html.match(/Hospital Status<br>([^<]*)</i)?.[1] || ''));

    // National totals row: the first numbers after "National Total"
    const nationalChunk = html.split(/National Total/i)[1]?.split(/HSE /)[0] || '';
    const nationalNums = [...nationalChunk.matchAll(/<t[dh][^>]*>\s*(\d+)\s*<\/t[dh]>/g)].map(m => Number(m[1]));

    // Each hospital row starts with its name in a div; numbers follow until the next name
    const parts = html.split(/padding-left:0\.5ex">/).slice(1);
    const hospitals = [];
    for (const part of parts) {
        const name = decode(part.split('<')[0]);
        const nums = [...part.matchAll(/<td[^>]*>\s*(\d+)\s*<\/td>/g)].map(m => Number(m[1]));
        // Hospitals with an emergency department have ED trolleys, ward trolleys and a total first;
        // the rest (e.g. Cappagh) only report delayed transfers of care
        if (nums.length < 3 || nums[0] + nums[1] !== nums[2]) continue;
        hospitals.push({ name, county: countyOf(name), ed: nums[0], ward: nums[1], total: nums[2] });
    }

    if (hospitals.length < 20) throw new Error(`Only ${hospitals.length} hospitals read from TrolleyGAR`);
    const sum = hospitals.reduce((s, h) => s + h.total, 0);
    const national = nationalNums.length >= 3 && nationalNums[0] + nationalNums[1] === nationalNums[2]
        ? { ed: nationalNums[0], ward: nationalNums[1], total: nationalNums[2] }
        : { ed: null, ward: null, total: sum };
    if (national.total !== sum) console.warn(`   Trolleys: hospitals add up to ${sum}, report says ${national.total}`);

    const unmatched = hospitals.filter(h => !h.county).map(h => h.name);
    if (unmatched.length) console.warn(`   Trolleys: no county for ${unmatched.join(', ')}`);

    const counties = {};
    for (const h of hospitals) {
        if (!h.county) continue;
        const c = counties[h.county] || (counties[h.county] = { total: 0, hospitals: 0 });
        c.total += h.total;
        c.hospitals++;
    }

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        reported: heading || null,   // e.g. "08:00 Thursday -" (the page gives the weekday, not the date)
        national,
        hospitals: hospitals.sort((a, b) => b.total - a.total),
        counties
    };
}

module.exports = { fetchTrolleys };
