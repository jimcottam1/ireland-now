# Test fixtures

Saved answers from the real sources, used so tests never touch the network. Keep each under about 200 KB.
Live data is dated when it was saved (1 November 2026); tests freeze the clock with `freezeClock` instead of re-dating the files.

## CSO tables (`cso-*.json`)

Real JSON-stat 2.0 tables with the real dimension ids, category codes and labels, cut down to the categories a layer uses
plus a few distractors (other sexes, ages, bedrooms, property types, sub-offences, towns) so a wrong pick shows up.
The values array is cut to match. Fetch the full table, then trim it:

    curl -s "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/MUM01/JSON-stat/2.0/en" > MUM01.json
    node trim.js MUM01.json test/fixtures/cso-MUM01.json '{"TLIST":{"last":26}}'

`trim.js` (kept here as a note, not part of the build). Rule keys are dimension id prefixes; a rule is `{"last":n}`,
a list of exact labels, or `{"match":"regex"}`. Dimensions without a rule are kept whole.

```js
const fs = require('fs');
const [, , inFile, outFile, rulesJson] = process.argv;
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const rules = JSON.parse(rulesJson || '{}');
const keep = raw.id.map(id => {
    const cat = raw.dimension[id].category;
    const key = Object.keys(rules).find(k => id.startsWith(k));
    const rule = key && rules[key];
    let codes = cat.index.slice();
    if (Array.isArray(rule)) codes = codes.filter(c => rule.includes(cat.label[c]));
    else if (rule && rule.last) codes = codes.slice(-rule.last);
    else if (rule && rule.match) codes = codes.filter(c => new RegExp(rule.match).test(cat.label[c]));
    return codes;
});
const oldPos = raw.id.map(id => Object.fromEntries(raw.dimension[id].category.index.map((c, p) => [c, p])));
const values = [];
(function walk(d, offset) {
    if (d === raw.id.length) { values.push(raw.value[offset]); return; }
    for (const c of keep[d]) walk(d + 1, offset * raw.size[d] + oldPos[d][c]);
})(0, 0);
raw.id.forEach((id, i) => {
    const cat = raw.dimension[id].category;
    cat.index = keep[i];
    cat.label = Object.fromEntries(keep[i].map(c => [c, cat.label[c]]));
    for (const k of ['unit', 'child', 'note']) if (cat[k]) cat[k] = Object.fromEntries(Object.entries(cat[k]).filter(([c]) => keep[i].includes(c)));
});
raw.size = keep.map(k => k.length);
raw.value = values;
delete raw.link; delete raw.extension; delete raw.note;
fs.writeFileSync(outFile, JSON.stringify(raw));
```

Rules used:

| Table | Layer | Rules |
| --- | --- | --- |
| MUM01 | economy | `TLIST` last 26 |
| CPM20 | economy | `TLIST` last 14; `STATISTIC` matching `12 months\|1 month\|December 2023`; `C04624` All Items plus two others |
| NDM01 | economy | `TLIST` last 30 |
| LRM15 | economy | `TLIST` last 15 |
| NDQ05 | economy | `TLIST` last 10 |
| RIQ02 | rents | `TLIST` last 10; bedrooms All, One, Two; types All, Apartment; locations the 26 counties, a few cities, towns and Dublin postcodes |
| CJQ10 | crime | `TLIST` last 10; offences matching `\(\d{2}\)\s*$\|\(081\)\|\(071\)` (the 16 top-level groups plus a sub-group) |
| F1020 | census | none (small already) |
| FY095 | census | `C02199` Both sexes and Male; `C02076` All ages, 3 - 4 years, 5 - 9 years |
| F7065 | census | `STATISTIC` three of twelve; `C02199` Both sexes and Male |

The real RIQ02 table has no national "Ireland" row, and CJQ10 has no figures before 2025 for the current Garda divisions;
the tests rely on both.

## Other sources

| File | Source | How it was made |
| --- | --- | --- |
| `rivers-latest.json` | `https://waterlevel.ie/geojson/latest/` | Whole answer is 740 KB; kept every sensor of 9 gauges (3 each in Dublin, Cork, Donegal; one Cork gauge, Killavullen, is stale since July) |
| `noaa-kp-forecast.json` | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json` | Whole answer |
| `emsc-quakes.json` | `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minlat=51.2&maxlat=55.6&minlon=-11.0&maxlon=-5.3&starttime=2025-11-01&limit=200&orderby=time` | Whole answer (17 events) |
| `erddap-buoys.json` | `https://erddap.marine.ie/erddap/tabledap/IWBNetwork.json?...` (the layer's query, last 6 hours) | Whole answer |
| `erddap-tides.json` | `https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.json?...` (last 2 hours) | Rows of the first 8 stations |
| `openmeteo-airquality.json` | `https://air-quality-api.open-meteo.com/v1/air-quality?...` for the 32 county centres in `scripts/lib/geo.js` | Whole answer |
| `oireachtas-debates.json` | `https://api.oireachtas.ie/v1/debates?chamber_type=house&chamber=dail&date_start=2026-10-01&limit=10` | First 4 sitting days; each section cut to `{debateSectionId, showAs}` |
| `oireachtas-bills.json` | `https://api.oireachtas.ie/v1/legislation?date_start=2026-10-01&limit=100&bill_status=Current,Enacted` | All 14 bills, cut to the fields the layer reads (title, status, source, most recent stage, sponsors) |
| `arcgis-water.json` | Uisce Éireann `WaterAdvisoryCR021_DeptView` layer, the layer's own query (`ENDDATE IS NULL OR ENDDATE >= CURRENT_TIMESTAMP`), saved 7 November 2026 | All 344 records (open-ended boil water and do-not-consume notices, open-ended works, 21 blank records, one lifting notice); descriptions cut to 100 characters, coordinates to 5 decimals |
| `oireachtas-members.json` | `https://api.oireachtas.ie/v1/members?chamber=dail&house_no=34&limit=250`, saved 7 November 2026 | The 24 members for Galway West, Dublin Central, Kerry, Cavan-Monaghan and Wicklow-Wexford, including two who left (Catherine Connolly, Paschal Donohoe) and the by-election winners (Seán Kyne, Daniel Ennis); cut to the fields the layer reads |
| `met-forecast-dublin.xml` | `http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=53.35;long=-6.26` | Entries up to 4 November 2026 only (the HARMONIE model part, 1-hour steps) |
