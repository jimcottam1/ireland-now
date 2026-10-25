// EPA bathing water: every designated beach, its water quality classification and any restrictions.
const { getJson } = require('../lib/http');
const { countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'EPA bathing water (beaches.ie)',
    url: 'https://www.beaches.ie/',
    licence: 'CC BY 4.0'
};

async function fetchBeaches() {
    const raw = await getJson('https://data.epa.ie/bw/api/v1/locations?per_page=500', { timeoutMs: 60000 });

    const beaches = raw.list.map(b => ({
        name: b.beach_name,
        county: countyFromName(b.county_name),
        classification: b.current_annual_water_quality_classification || null,
        classificationYear: b.current_annual_classification_year || null,
        blueFlag: Boolean(b.is_blue_flag),
        greenCoast: Boolean(b.is_green_coast),
        restricted: Boolean(b.has_all_season_bathing_restriction_in_place),
        restriction: b.reason_for_all_season_bathing_restriction || null,
        lifeguard: Boolean(b.has_lifeguard),
        profile: b.beach_profile_url || null
    })).sort((a, b) => a.name.localeCompare(b.name));

    const counties = {};
    for (const b of beaches) {
        if (!b.county) continue;
        const c = counties[b.county] || (counties[b.county] = { beaches: 0, blueFlag: 0, excellent: 0, poor: 0, restricted: 0 });
        c.beaches++;
        if (b.blueFlag) c.blueFlag++;
        if (/excellent/i.test(b.classification || '')) c.excellent++;
        if (/poor/i.test(b.classification || '')) c.poor++;
        if (b.restricted) c.restricted++;
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, beaches, counties };
}

module.exports = { fetchBeaches };
