# Ireland Now

A clickable map of live public data for every county in Ireland, published as a static site on GitHub Pages.

Search for any town, parish or island, click anywhere for its townland and Irish name, or click a county for its weather warnings, current weather, water notices, river levels, bathing waters, house prices, population and TDs. Colour the map by warnings, temperature, rain, house prices, price change, population density or water notices, and switch on live points for water notices, river gauges, tide gauges and trains.

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
| Water notices | [Uisce Éireann](https://www.water.ie/water-service-updates) public map layer | Hourly |
| River levels | [OPW waterlevel.ie](https://waterlevel.ie/) | Hourly |
| Tides | [Marine Institute](https://www.marine.ie/) tide gauge network (ERDDAP) | Hourly |
| Trains | [Irish Rail realtime API](https://api.irishrail.ie/realtime/) | Hourly snapshot |
| Buses | [NTA GTFS-Realtime](https://developer.nationaltransport.ie/) (needs the `NTA_API_KEY` repository secret; route names from the TFI timetable, weekly) | Hourly snapshot |
| Electricity | [EirGrid Smart Grid Dashboard](https://www.smartgriddashboard.com/) | Hourly |
| Bathing waters | [EPA](https://data.epa.ie/) bathing water API | Daily |
| TDs | [Oireachtas API](https://api.oireachtas.ie/) | Daily |
| House prices | [Property Price Register](https://www.propertypriceregister.ie/) | Daily |
| Population | [CSO](https://data.cso.ie/table/FY003A) Census 2022 | Monthly |
| Place names | [Logainm](https://www.logainm.ie/) (needs the `LOGAINM_API_KEY` repository secret): 55,000 townlands, towns, parishes, baronies and islands, for the search box and click-for-townland | Monthly |
| County boundaries | [Tailte Éireann](https://data-osi.opendata.arcgis.com/) (simplified, in `public/data/`) | Fixed |

Map tiles © OpenStreetMap contributors.

## Not included (yet)

- **Power cuts:** ESB Networks' PowerCheck API needs a subscription key.
- **Hospital trolleys:** INMO publishes these through its website, not a public feed.
- **Air quality:** the EPA's air quality site doesn't offer a public API.

## Local development

```bash
npm install
npm run build      # fetch everything into site/
npm run preview    # serve site/ locally
npm run counties   # only if county boundaries need regenerating
```
