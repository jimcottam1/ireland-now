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
// Boil water, do-not-drink and restriction notices stay in force until lifted, so they often have no end date.
// Works records without one are usually ones nobody closed, so those are left out.
const OPEN_ENDED_KINDS = new Set(['boil-water', 'do-not-drink', 'restrictions']);

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
    // The layer holds every notice ever issued (8,000+), and the server sends at most 1,000 at a time,
    // so ask only for ones that haven't ended
    const params = new URLSearchParams({
        where: 'ENDDATE IS NULL OR ENDDATE >= CURRENT_TIMESTAMP',
        outFields: 'OBJECTID,WORKTYPE,TITLE,STARTDATE,ENDDATE,DESCRIPTION,COUNTY,LOCATION,REFERENCENUM,BOILWATERNOTICE,DONOTDRINK,WATEROUTAGE,REDUCEDPRESSURE,DISCOLOURATION,WATERRESTRICTIONS,APPROVALSTATUS',
        orderByFields: 'STARTDATE DESC',
        resultRecordCount: '2000',
        outSR: '4326',
        f: 'json'
    });
    const raw = await getJson(`${LAYER}?${params}`, { timeoutMs: 60000 });
    if (raw.error) throw new Error(`ArcGIS: ${raw.error.message}`);
    if (!Array.isArray(raw.features)) throw new Error('ArcGIS answer not recognised (no features)');
    if (raw.exceededTransferLimit) throw new Error(`ArcGIS has more notices than the ${raw.features.length} it sent`);

    const now = Date.now();
    const horizon = now + UPCOMING_DAYS * 86400000;

    const notices = raw.features
        .map(({ attributes: a, geometry: g }) => ({ a, g, kind: kindOf(a) }))
        // Untitled or undated records are blanks; "Lifting of ..." notices say a notice has ended, so they aren't warnings
        .filter(({ a }) => a.TITLE && a.STARTDATE > 0 && !/^lifting\b/i.test(a.TITLE.trim()))
        // Current, or starting within the next week
        .filter(({ a, kind }) => (a.ENDDATE ? a.ENDDATE >= now : OPEN_ENDED_KINDS.has(kind)) && a.STARTDATE <= horizon)
        .map(({ a, g, kind }) => {
            const lon = g?.x;
            const lat = g?.y;
            return {
                id: a.OBJECTID,
                title: a.TITLE,
                kind,
                planned: a.WORKTYPE === 'Planned',
                active: a.STARTDATE <= now,
                start: new Date(a.STARTDATE).toISOString(),
                end: a.ENDDATE ? new Date(a.ENDDATE).toISOString() : null, // null: until further notice
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
