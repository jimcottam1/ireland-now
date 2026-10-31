// Houses of the Oireachtas: what the Dáil has been doing lately (latest sitting day's business and
// bills that moved in the last month). Members are a separate layer (tds.js).
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'Houses of the Oireachtas Open Data (debates and bills)',
    url: 'https://www.oireachtas.ie/en/debates/',
    licence: 'Oireachtas (Open Data) PSI Licence'
};

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Procedural headings ("Leaders' Questions", "Order of Business") are written bilingually, "Irish - English"
const procedural = title => / - /.test(title) || /^(Message from|Business of Dáil|Estimates for Public Services)/i.test(title);

async function fetchDail() {
    const [debates, bills] = await Promise.all([
        getJson(`https://api.oireachtas.ie/v1/debates?chamber_type=house&chamber=dail&date_start=${daysAgo(30)}&limit=10`, { timeoutMs: 60000 }),
        getJson(`https://api.oireachtas.ie/v1/legislation?date_start=${daysAgo(30)}&limit=100&bill_status=Current,Enacted`, { timeoutMs: 60000 })
    ]);

    const days = (debates.results || []).map(r => r.debateRecord).sort((a, b) => b.date.localeCompare(a.date));
    const latest = days[0];
    const topics = latest
        ? [...new Set((latest.debateSections || []).map(s => s.debateSection.showAs).filter(t => t && !procedural(t)))]
        : [];

    const recentBills = (bills.results || []).map(({ bill: b }) => {
        const stage = b.mostRecentStage?.event;
        const sponsor = b.sponsors?.find(s => s.sponsor?.isPrimary)?.sponsor || b.sponsors?.[0]?.sponsor;
        return {
            title: b.shortTitleEn,
            status: b.status,
            source: b.source,
            stage: stage?.showAs || null,
            stageDate: stage?.dates?.[0]?.date || null,
            house: stage?.house?.showAs || null,
            sponsor: sponsor?.by?.showAs || sponsor?.as?.showAs || null,
            url: `https://www.oireachtas.ie/en/bills/bill/${b.billYear}/${b.billNo}/`
        };
    }).filter(b => b.title)
        .sort((a, b) => (b.stageDate || '').localeCompare(a.stageDate || ''))
        .slice(0, 12);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        lastSitting: latest ? { date: latest.date, topics: topics.slice(0, 15), url: `https://www.oireachtas.ie/en/debates/debate/dail/${latest.date}/` } : null,
        sittingDays: days.length,
        bills: recentBills
    };
}

module.exports = { fetchDail };
