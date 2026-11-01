# Ireland Now

A clickable map of live public data for all 32 counties on the island of Ireland, published as a static site on GitHub Pages.

Northern Ireland's six counties get weather, forecasts, air quality, Met Office warnings, NI Water incidents, earthquakes, electricity (EirGrid is all-island) and daylight. Sources that only cover the Republic (CSO, HSE, Property Price Register, RTB, TDs and so on) are left out of their panels and show as "not covered" on the map.

Search for any town, parish or island, click anywhere for its townland and Irish name, or click a county for its weather warnings, current and measured weather, 3-day forecast, air quality, hospital trolleys, water notices, river levels, bathing waters, jobs, new homes, house prices, population and TDs. The national view adds electricity, fuel prices, the Dáil, the Northern Lights outlook and earthquakes. Colour the map by warnings, temperature, rain, air quality, trolleys, new homes, house prices, price change, population density or water notices, and switch on live points for water notices, weather stations, river gauges, tide gauges, sea buoys, earthquakes, trains and buses.

## How it works

```
GitHub Actions (every hour at :17, on push, or run manually)
  scripts/build.js   fetch every layer -> site/data/*.json, copy public/ -> site/
  deploy             site/ -> GitHub Pages
```

There's no server or database. Each layer is a small script in `scripts/layers/`. If a source fails, the build keeps that layer's last good copy (marked as older data on the page) and carries on with the rest.

The `state/` folder carries over between runs in the GitHub Actions cache. It holds 48 hours of river level history (the OPW feed only gives the latest reading, so rising/falling is worked out here) and the slower layers, which are only refetched daily (beaches, TDs, house prices) or monthly (population).

Every summary card and section says how old its figures are at the source (not when the site fetched them), and turns orange when a source is older than it should be. An open page checks for a new build every 10 minutes and updates itself.

If a source fails on every build for more than 24 hours, `scripts/check-sources.js` opens a GitHub issue labelled `data-source`, and closes it when the source recovers.

Measured weather (7 days per Met Éireann station) and river levels (48 hours per gauge) are kept in `state/` and published as small per-county files, so the county panels can show trend charts.

## Data sources

| Layer | Source | Refreshed |
| --- | --- | --- |
| Weather warnings | [Met Éireann](https://www.met.ie/warnings) open data; [Met Office](https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings) RSS for Northern Ireland | Hourly |
| Weather now | [Open-Meteo](https://open-meteo.com/) at each county's centre | Hourly |
| Weather measured | [Met Éireann observations](https://www.met.ie/latest-reports/observations) from 23 synoptic stations | Hourly |
| Forecast | [Met Éireann forecast API](https://data.gov.ie/dataset/met-eireann-forecast-api) at each county's centre, next 3 days | Every 3 hours |
| Air quality | [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS model estimate, not EPA measurements) | Hourly |
| Sea buoys | [Marine Institute](https://www.marine.ie/) weather buoy network (ERDDAP): waves, wind, sea temperature | Hourly |
| Hospital trolleys | [HSE TrolleyGAR](https://uec.hse.ie/uec/TGAR.php) daily 8am report (read from the web page; weekdays) | Hourly check |
| Northern Lights | [NOAA SWPC](https://www.swpc.noaa.gov/products/planetary-k-index) planetary Kp index and forecast | Hourly |
| Earthquakes | [EMSC](https://www.seismicportal.eu/), including the Irish National Seismic Network's small quakes | Every 3 hours |
| Fuel prices | [EU Weekly Oil Bulletin](https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en): national average petrol, diesel, heating oil | Daily (published weekly) |
| Jobs, prices, new homes | [CSO](https://data.cso.ie/): unemployment (MUM01), inflation (CPM20), new homes (NDM01, NDQ05), Live Register by county (LRM15) | Daily |
| Rents | [RTB Rent Index](https://www.rtb.ie/data-insights/rtb-rent-index) via the CSO (RIQ02): average rent for new tenancies by county | Daily (published quarterly) |
| Planning applications | [Planning Application Points](https://data-housinggovie.opendata.arcgis.com/datasets/housinggovie::planning-application-points) (Department of Housing, Local Government and Heritage and local authorities, CC BY 4.0): applications received per county in the 30 days up to the latest date every healthy council has reached, as counts only. Republic only. The data lags about 9 to 10 days. A county is greyed out as incomplete when a council's feed is over 21 days behind, has fewer than 40% of its previous 30 days (when that was 20 or more), or is missing, so counts are not comparable between councils | Daily (updated about weekly) |
| Crime | [CSO recorded crime](https://data.cso.ie/table/CJQ10) by Garda division (CJQ10), published under reservation | Daily (published quarterly) |
| Census profile | [CSO Census 2022](https://data.cso.ie/): age (F1020), Irish speakers (FY095), how people get to work (F7065) | Monthly |
| Sunrise, sunset, moon | Calculated in the browser (standard astronomical formulas), no data source | Live |
| Dáil activity | [Oireachtas API](https://api.oireachtas.ie/): latest sitting day and bills from the last month | Every 6 hours |
| NI Water incidents | [NI Water current service updates](https://www.niwater.com/whats-happening-in-your-area/current-service-updates) (read from the page; robots.txt allows it) | Hourly |
| Luas line status and stops | [Luas forecast feed](https://luasforecasts.rpa.ie/) (no key; no robots.txt restrictions): status message for the Red and Green lines and the stop list. Tram times are not shown | Hourly |
| RNLI lifeboat launches | [RNLI launches feed](https://services.rnli.org/api/launches) (no key; the site has no robots.txt) for launches, joined by station name to the [RNLI Open Data station locations](https://data-rnli.opendata.arcgis.com/) (Contains Open Data licensed under the GIS Open Data Licence), cached 30 days. The feed holds only the latest ~20 UK-wide launches, so each Irish launch is remembered for 7 days between runs. Feed times are UK local time | Hourly |
| Water notices | [Uisce Éireann](https://www.water.ie/water-service-updates) public map layer | Hourly |
| River levels | [OPW waterlevel.ie](https://waterlevel.ie/) | Hourly |
| Tides | [Marine Institute](https://www.marine.ie/) tide gauge network (ERDDAP) | Hourly |
| Trains | [Irish Rail realtime API](https://api.irishrail.ie/realtime/) | Hourly snapshot |
| Buses | [NTA GTFS-Realtime](https://developer.nationaltransport.ie/) (needs the `NTA_API_KEY` repository secret; route names from the TFI timetable, weekly) | Hourly snapshot |
| Electricity | [EirGrid Smart Grid Dashboard](https://www.smartgriddashboard.com/): demand, wind and carbon, with a 24-hour chart | Hourly |
| Bathing waters | [EPA](https://data.epa.ie/) bathing water API | Daily |
| TDs | [Oireachtas API](https://api.oireachtas.ie/) | Daily |
| House prices | [Property Price Register](https://www.propertypriceregister.ie/) | Daily |
| Population | [CSO](https://data.cso.ie/table/FY003A) Census 2022 | Monthly |
| Place names | [Logainm](https://www.logainm.ie/) (needs the `LOGAINM_API_KEY` repository secret): 55,000 townlands, towns, parishes, baronies and islands, for the search box and click-for-townland | Monthly |
| County boundaries | [Tailte Éireann](https://data-osi.opendata.arcgis.com/) for the Republic, [OSNI Open Data](https://www.spatialni.gov.uk/) (Open Government Licence) for Northern Ireland; simplified, in `public/data/` | Fixed |

Map tiles © OpenStreetMap contributors.

## Not included (yet)

- **Power cuts:** ESB Networks has no public API. PowerCheck's backend uses a private key, so this waits on permission from ESB.
- **Fuel prices by county or station:** there's no official source; the Oil Bulletin gives the national average only.
- **Measured air quality:** the EPA's airquality.ie doesn't offer a public API, so the map uses model estimates.

## Local development

```bash
npm install
npm run build      # fetch everything into site/
npm run preview    # serve site/ locally
npm run counties   # only if county boundaries need regenerating
npm test           # offline tests on saved responses; CI runs these before every build
```
