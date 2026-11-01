# Ireland Now: notes for agents

A static site: GitHub Actions runs `scripts/build.js` every hour, which fetches each data layer into `site/data/*.json` and deploys `site/` to GitHub Pages. There is no server. See README.md for every source.

## Commands
- `npm test`: runs `test/*.test.js` (Node's built-in runner, no network). Must pass before any commit.
- `npm run build`: fetches every live source into `site/` (needs network; buses need `NTA_API_KEY`, place names `LOGAINM_API_KEY`, so those fall back to their last good copy locally).
- `npx serve site`: preview at http://localhost:3000. After changing only `public/`, copy `public/app.js` and `public/styles.css` into `site/` instead of rebuilding.
- `npm run counties`: regenerate `public/data/counties.geojson` (rarely).

## How we work
- **Test first.** A new layer or a changed parser needs a test in `test/` with a saved sample response in `test/fixtures/`. Use `mockHttp` and `loadLayer` from `test/helpers.js`. Tests must not depend on today's date (restamp fixture dates, or check day and time rather than year).
- **Check a test catches the bug.** After writing one, break the code on purpose and confirm the test fails, then put the code back.
- **Never push, deploy or create GitHub issues without asking the owner.** Pushing to `main` deploys the live site.
- **Look at the real page.** For anything visible, check it in a browser at desktop width and at phone width (390 px). A 390 × 844 iframe preview works when the window can't be resized. Check the browser console for errors.
- Ask the owner before adding a user-visible feature or a new data source; suggest a recommended option.

## Data rules
- **Only public, permitted sources.** Check `robots.txt` and the source's terms first. Never use a private API key taken from another site's page, never get around CAPTCHAs or bot checks, and never scrape a site whose `robots.txt` disallows it (ESB PowerCheck, for example).
- **Every figure shows its age at the source**, not when we fetched it: a timestamp, week, month, quarter or census date, with an orange ⚠ when it's older than the source's usual update cycle.
- **Republic and Northern Ireland:** 32 counties. Most sources cover the Republic only (`ROI_IDS`); hide those sections in Northern Ireland panels and say "Not covered in Northern Ireland" on map views. All-island views set `allIsland: true`.
- **A failed source keeps its last good copy.** A layer should throw on anything it doesn't recognise rather than publish empty or wrong data. Parsers of web pages (HSE TrolleyGAR, NI Water, EU Oil Bulletin page) must sanity-check what they read.
- Credit every source in its `SOURCE` object (name, URL, licence); the footer lists them automatically.
- No secrets in the page or the repo; keys are GitHub repository secrets.

## Code layout
- `scripts/layers/<name>.js`: one per source, exporting `fetch<Name>()` that returns `{ updatedAt, source, ... }`, optionally `sourceTime` and `files` (extra files under `site/data/`). Register it in `scripts/build.js` with its cache age in hours.
- `scripts/lib/`: `http` (polite fetch with retries), `geo` (county lookups, `ROI_IDS`/`NI_IDS`), `time` (Irish local time to UTC), `jsonstat` (CSO tables), `state` (history kept between runs).
- `public/app.js`: the whole front end (views, overlays, panels, help popups, map interaction). `public/styles.css`: one stylesheet with light and dark themes.
- `scripts/check-sources.js`: opens a `data-source` GitHub issue when a layer has failed for over 24 hours.

## Writing
Plain British/Irish English, short sentences, no jargon on the page. Words users will read need the owner's agreement.

## Gotchas
- Editing files through shell heredocs mangles `\b`, `\d` and backticks; use the Edit tool for regex-heavy code, and check for stray control characters afterwards.
- Git Bash rewrites command-line arguments that start with `/` into Windows paths; set `MSYS_NO_PATHCONV=1` when passing such text to a script.
- Met Éireann's observations API answers an unknown station with Dublin Airport's data; always check the station name.
- Leaflet: overlay dots are on a canvas; their clicks go through `mapClick` (pick list, never selecting the county underneath).
