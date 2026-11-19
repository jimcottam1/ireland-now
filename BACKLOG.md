# Backlog

Ideas waiting to be built, roughly in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## Ready (no key needed, source checked)
- (none right now)

## Needs something from the owner
- **Bus and train disruptions:** service alerts (diversions, cancellations, strikes) may be in the NTA GTFS-Realtime feed the buses layer already uses, but that can't be checked without the `NTA_API_KEY` locally, and the key allows only about one request a minute (the buses layer already uses two). Needs a sample answer saved with the key, or a one-off check in Actions. Checked 19 Nov 2026.
- **Measured air quality:** the EPA's open air quality API (`data.epa.ie/air/api/v1/measurements`, CC BY 4.0) has no date filter and its later pages time out (HTTP 500 after 30 s), so recent readings can't be reached; airquality.ie's live readings answer "FORBIDDEN" to scripts. OpenAQ carries the EPA stations but needs a free key from openaq.org. Checked 19 Nov 2026.
- **EV chargers:** per county (Open Charge Map key from openchargemap.org).

## Not checked yet
- **ESB historical outages:** outages by county 2021–2024 from ESB's FOI disclosure log, if the figures are published there.
- **Sunrise-style quick wins:** next bank holiday and school holidays (calculated, no source).
- **Planes overhead:** OpenSky Network (free, non-commercial use with credit; check the terms fit).

## Waiting on someone else
- **Road cameras (TII, TrafficwatchNI):** live motorway and road camera pictures. TII's open data (CC BY 4.0) doesn't include the camera images, and no reuse terms were found for trafficinfo.ie or TrafficwatchNI cameras. Needs an email to opendata@tii.ie (and DfI) first. Checked 8 Nov 2026.
- **Power cuts (ESB PowerCheck):** no public API; `robots.txt` blocks it. Waiting on the owner's email to ESB.
- **Schools:** the Department of Education's school lists (with pupil numbers) are published on gov.ie / education.ie, which answers scripts with a CloudFront "Request blocked" (403). data.gov.ie only links there, and its copies are from 2016/17. Needs an email to the Department for a direct file or permission. Checked 19 Nov 2026.

## Ruled out
- **Traffic journey times (TII):** the national roads travel-time feed (`data.tii.ie/Datasets/Its/DatexII/TravelTimeData/`) stopped updating on 30 Jan 2021. Checked 19 Nov 2026.
- **Ferry sailings:** no open feed from Irish Ferries, Stena Line or the ports. Checked 19 Nov 2026.

## Quality
- Split `public/app.js` (about 2,200 lines) into views, overlays, panels, map interaction and help.
- Check on a real phone: two-finger map moving, the ◎ location button, the "View county" button.

## Done
- Tests, CI gate and `CLAUDE.md` (0520677)
- Luas status and stops (5746fea, e961f0f)
- RNLI lifeboat launches (8fe7d5d, be70680)
- Dublin Bikes (0e5809f, 0b78f91)
- Planning applications (a89e74c, 3f1911a)
- Tests for the CSO layers, rivers, air quality, earthquakes and the Dáil (4a5b309)
- Hospital waiting lists, heritage sites, attractions and trails (374912d)
- Map held to Ireland (f8b7f36)
- Trail routes, wildlife, river and lake quality, radon, broadband and rain radar (see `git log`)
