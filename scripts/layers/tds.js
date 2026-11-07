// Oireachtas: every TD in the current Dáil, their party, constituency and any office held.
const { getJson } = require('../lib/http');
const { countiesInName } = require('../lib/geo');

const SOURCE = {
    name: 'Houses of the Oireachtas Open Data',
    url: 'https://api.oireachtas.ie/',
    licence: 'Oireachtas (Open Data) PSI Licence'
};

const DAIL = 34; // the Dáil elected in November 2024
const MOST_SEATS = 5; // every constituency elects 3, 4 or 5 TDs

const current = items => (items || []).find(i => !i.dateRange?.end) || (items || []).slice(-1)[0];

async function fetchTds() {
    const raw = await getJson(`https://api.oireachtas.ie/v1/members?chamber=dail&house_no=${DAIL}&limit=250`, { timeoutMs: 60000 });
    if (!raw.results?.length) throw new Error('Oireachtas returned no TDs');

    // The list includes everyone who sat in this Dáil; a membership with an end date means they've left
    // (elected President, to Europe, resigned or died), and a by-election winner holds the seat now
    const sitting = raw.results.map(({ member: m }) => ({
        m,
        membership: (m.memberships || []).map(x => x.membership).find(x => Number(x.house?.houseNo) === DAIL)
    })).filter(({ membership }) => membership && !membership.dateRange?.end);

    const tds = sitting.map(({ m, membership }) => {
        const constituency = current(membership?.represents)?.represent?.showAs || '';
        const party = current(membership?.parties)?.party?.showAs || 'Independent';
        const offices = (membership?.offices || [])
            .filter(o => !o.office?.dateRange?.end)
            .map(o => o.office?.officeName?.showAs)
            .filter(Boolean);
        return {
            name: m.fullName,
            party,
            constituency,
            offices,
            counties: countiesInName(constituency),
            url: `https://www.oireachtas.ie/en/members/member/${encodeURIComponent(m.memberCode)}/`
        };
    }).sort((a, b) => a.constituency.localeCompare(b.constituency) || a.name.localeCompare(b.name));

    const seats = {};
    for (const t of tds) seats[t.constituency] = (seats[t.constituency] || 0) + 1;
    const over = Object.entries(seats).find(([, n]) => n > MOST_SEATS);
    if (over) throw new Error(`${over[0]} has ${over[1]} TDs, more than any constituency elects`);

    const unmatched = tds.filter(t => !t.counties.length).map(t => t.constituency);
    if (unmatched.length) console.warn(`   TDs: no county for ${[...new Set(unmatched)].join(', ')}`);

    const counties = {};
    for (const t of tds) {
        for (const id of t.counties) {
            const c = counties[id] || (counties[id] = { tds: 0, constituencies: [] });
            c.tds++;
            if (!c.constituencies.includes(t.constituency)) c.constituencies.push(t.constituency);
        }
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, tds, counties };
}

module.exports = { fetchTds };
