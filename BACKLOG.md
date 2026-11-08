# Backlog

Ideas waiting to be built, roughly in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## Ready (no key needed, source checked)
- **Luas status:** whether each line is running normally, from the RPA forecast feed (`luasforecasts.rpa.ie`, no key). Checked 31 Oct 2026.
- **RNLI lifeboat launches:** recent callouts at Irish stations (`services.rnli.org/api/launches`, no key; covers the UK too, so filter to Ireland).

## Needs a free key from the owner
- **Dublin Bikes:** bikes and free stands per station (JCDecaux key from developer.jcdecaux.com).
- **EV chargers:** per county (Open Charge Map key from openchargemap.org).

## Not checked yet
- **Planning applications:** new applications per county from the national planning map.
- **ESB historical outages:** outages by county 2021–2024 from ESB's FOI disclosure log, if the figures are published there.

## Waiting on someone else
- **Road cameras (TII, TrafficwatchNI):** live motorway and road camera pictures. TII's open data (CC BY 4.0) doesn't include the camera images, and no reuse terms were found for trafficinfo.ie or TrafficwatchNI cameras. Needs an email to opendata@tii.ie (and DfI) first. Checked 8 Nov 2026.
- **Power cuts (ESB PowerCheck):** no public API; `robots.txt` blocks it. Waiting on the owner's email to ESB.

## Quality
- Tests for the CSO layers (economy, rents, crime, census), rivers, air quality, earthquakes and the Dáil.
- Split `public/app.js` (about 1,600 lines) into views, overlays, panels, map interaction and help.
- Check on a real phone: two-finger map moving, the ◎ location button, the "View county" button.

## Done
- Tests, CI gate and `CLAUDE.md` (0520677)
