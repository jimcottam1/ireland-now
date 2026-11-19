# Backlog

Ideas waiting to be built, roughly in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## Ready (no key needed, source checked)
- **Trail routes as lines:** draw each trail's whole route, not just a dot where it starts. Sport Ireland's register has the lines (about 32,500 points at 100 m detail, roughly 650 KB), so load them as a separate file only when Trails is switched on. Checked 19 Nov 2026.

## Needs a free key from the owner
- **EV chargers:** per county (Open Charge Map key from openchargemap.org).

## Not checked yet
- **ESB historical outages:** outages by county 2021–2024 from ESB's FOI disclosure log, if the figures are published there.
- **Sunrise-style quick wins:** next bank holiday and school holidays (calculated, no source).
- **Planes overhead:** OpenSky Network (free, non-commercial use with credit; check the terms fit).

## Waiting on someone else
- **Road cameras (TII, TrafficwatchNI):** live motorway and road camera pictures. TII's open data (CC BY 4.0) doesn't include the camera images, and no reuse terms were found for trafficinfo.ie or TrafficwatchNI cameras. Needs an email to opendata@tii.ie (and DfI) first. Checked 8 Nov 2026.
- **Power cuts (ESB PowerCheck):** no public API; `robots.txt` blocks it. Waiting on the owner's email to ESB.

## Ruled out
- **Traffic journey times (TII):** the national roads travel-time feed (`data.tii.ie/Datasets/Its/DatexII/TravelTimeData/`) stopped updating on 30 Jan 2021. Checked 19 Nov 2026.

## Quality
- Split `public/app.js` (about 2,000 lines) into views, overlays, panels, map interaction and help.
- Check on a real phone: two-finger map moving, the ◎ location button, the "View county" button.

## Done
- Tests, CI gate and `CLAUDE.md` (0520677)
- Luas status and stops (5746fea, e961f0f)
- RNLI lifeboat launches (8fe7d5d, be70680)
- Dublin Bikes (0e5809f, 0b78f91)
- Planning applications (a89e74c, 3f1911a)
- Tests for the CSO layers, rivers, air quality, earthquakes and the Dáil (4a5b309)
- Hospital waiting lists, heritage sites, attractions and trails (this commit; see `git log`)
