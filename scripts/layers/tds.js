// Oireachtas: every TD in the current Dáil, their party, constituency and any office held.
const { getJson } = require('../lib/http');
const { countiesInName } = require('../lib/geo');

const SOURCE = {
    name: 'Houses of the Oireachtas Open Data',
    url: 'https://api.oireachtas.ie/',
    licence: 'Oireachtas (Open Data) PSI Licence'
};

const DAIL = 34; // the Dáil elected in November 2024

const current = items => (items || []).find(i => !i.dateRange?.end) || (items || []).slice(-1)[0];

async function fetchTds() {
    const raw = await getJson(`https://api.oireachtas.ie/v1/members?chamber=dail&house_no=${DAIL}&limit=250`, { timeoutMs: 60000 });

    const tds = raw.results.map(({ member: m }) => {
        const membership = (m.memberships || []).map(x => x.membership).find(x => Number(x.house?.houseNo) === DAIL) || m.memberships?.[0]?.membership;
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
