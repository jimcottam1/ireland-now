# Ireland Now

A clickable map of live public data for every county in Ireland, published as a static site on GitHub Pages.

Search for any town, parish or island, click anywhere for its townland and Irish name, or click a county for its weather warnings, current and measured weather, 3-day forecast, air quality, hospital trolleys, water notices, river levels, bathing waters, jobs, new homes, house prices, population and TDs. The national view adds electricity, fuel prices, the Dáil, the Northern Lights outlook and earthquakes. Colour the map by warnings, temperature, rain, air quality, trolleys, new homes, house prices, price change, population density or water notices, and switch on live points for water notices, weather stations, river gauges, tide gauges, sea buoys, earthquakes, trains and buses.

## How it works

```
GitHub Actions (every hour at :17, on push, or run manually)
  scripts/build.js   fetch every layer -> site/data/*.json, copy public/ -> site/
  deploy             site/ -> GitHub Pages
```

There's no server or database. Each layer is a small script in `scripts/layers/`. If a source fails, the build keeps that layer's last good copy (marked as older data on the page) and carries on with the rest.

The `state/` folder carries over between runs in the GitHub Actions cache. It holds 48 hours of river level history (the OPW feed only gives the latest reading, so rising/falling is worked out here) and the slower layers, which are only refetched daily (beaches, TDs, house prices) or monthly (population).

## Data sources

| Layer | Source | Refreshed |
| --- | --- | --- |
| Weather warnings | [Met Éireann](https://www.met.ie/warnings) open data | Hourly |
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
| Dáil activity | [Oireachtas API](https://api.oireachtas.ie/): latest sitting day and bills from the last month | Every 6 hours |
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
| County boundaries | [Tailte Éireann](https://data-osi.opendata.arcgis.com/) (simplified, in `public/data/`) | Fixed |

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
```
