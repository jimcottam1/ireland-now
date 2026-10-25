// Uisce Éireann supply and service updates: outages, boil water and do-not-drink notices.
// Read from the public ArcGIS layer that powers water.ie's own map (no key needed).
const { getJson } = require('../lib/http');
const { countyAt, countyFromName } = require('../lib/geo');

const SOURCE = {
    name: 'Uisce Éireann supply and service updates',
    url: 'https://www.water.ie/water-service-updates',
    licence: 'Uisce Éireann public information'
};

const LAYER = 'https://services2.arcgis.com/OqejhVam51LdtxGa/arcgis/rest/services/WaterAdvisoryCR021_DeptView/FeatureServer/0/query';
const UPCOMING_DAYS = 7;

const yes = v => /^(yes|y|true|1)$/i.test(String(v ?? '').trim());
const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function kindOf(a) {
    if (yes(a.DONOTDRINK)) return 'do-not-drink';
    if (yes(a.BOILWATERNOTICE)) return 'boil-water';
    if (yes(a.WATERRESTRICTIONS)) return 'restrictions';
    if (yes(a.WATEROUTAGE)) return 'outage';
    if (yes(a.REDUCEDPRESSURE)) return 'low-pressure';
    if (yes(a.DISCOLOURATION)) return 'discolouration';
    return 'works';
}

async function fetchWater() {
    const params = new URLSearchParams({
        where: '1=1',
        outFields: 'OBJECTID,WORKTYPE,TITLE,STARTDATE,ENDDATE,DESCRIPTION,COUNTY,LOCATION,REFERENCENUM,BOILWATERNOTICE,DONOTDRINK,WATEROUTAGE,REDUCEDPRESSURE,DISCOLOURATION,WATERRESTRICTIONS,APPROVALSTATUS',
        orderByFields: 'STARTDATE DESC',
        resultRecordCount: '2000',
        outSR: '4326',
        f: 'json'
    });
    const raw = await getJson(`${LAYER}?${params}`, { timeoutMs: 60000 });
    if (raw.error) throw new Error(`ArcGIS: ${raw.error.message}`);

    const now = Date.now();
    const horizon = now + UPCOMING_DAYS * 86400000;

    const notices = raw.features
        .map(({ attributes: a, geometry: g }) => ({ a, g }))
        // Current, or starting within the next week
        .filter(({ a }) => a.ENDDATE && a.ENDDATE >= now && a.STARTDATE <= horizon)
        .map(({ a, g }) => {
            const lon = g?.x;
            const lat = g?.y;
            return {
                id: a.OBJECTID,
                title: a.TITLE,
                kind: kindOf(a),
                planned: a.WORKTYPE === 'Planned',
                active: a.STARTDATE <= now,
                start: new Date(a.STARTDATE).toISOString(),
                end: new Date(a.ENDDATE).toISOString(),
                description: plain(a.DESCRIPTION).slice(0, 600),
                reference: a.REFERENCENUM || null,
                lat: Number.isFinite(lat) ? Number(lat.toFixed(5)) : null,
                lon: Number.isFinite(lon) ? Number(lon.toFixed(5)) : null,
                county: countyFromName(a.COUNTY) || (Number.isFinite(lon) ? countyAt(lon, lat) : null)
            };
        });

    const counties = {};
    for (const n of notices) {
        if (!n.county) continue;
        const c = counties[n.county] || (counties[n.county] = { active: 0, upcoming: 0, boilWater: 0, doNotDrink: 0 });
        if (n.active) c.active++; else c.upcoming++;
        if (n.kind === 'boil-water') c.boilWater++;
        if (n.kind === 'do-not-drink') c.doNotDrink++;
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, notices, counties };
}

module.exports = { fetchWater };
