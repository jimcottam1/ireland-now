// Ireland Now: front end. Loads the hourly data files and draws the map, overlays and county panel.
(function () {
    'use strict';

    const LAYERS = ['warnings', 'weather', 'observations', 'forecast', 'airquality', 'rivers', 'tides', 'marine', 'trains', 'buses', 'grid', 'water',
        'niwater', 'trolleys', 'space', 'earthquakes', 'fuel', 'economy', 'rents', 'crime', 'census', 'dail', 'beaches', 'tds', 'housing', 'population', 'placenames', 'luas'];
    const data = {};
    let status = null;
    let counties = null;   // GeoJSON features
    let countyLayer = null;
    let selected = null;   // county id
    let view = 'warnings';
    const overlays = { water: true, stations: false, rivers: false, tides: false, buoys: false, quakes: false, trains: false, buses: false, luas: false };
    const overlayLayers = {};

    // ---------- Helpers ----------

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => n == null ? '–' : Number(n).toLocaleString('en-IE');
    const euro = n => n == null ? '–' : '€' + Math.round(n / 1000).toLocaleString('en-IE') + 'k';
    const pct = n => n == null ? '–' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    const nameOf = id => counties?.find(f => f.properties.id === id)?.properties.name || id;

    // Northern Ireland's six counties: most sources here cover the Republic only
    const isNI = id => counties?.find(f => f.properties.id === id)?.properties.jurisdiction === 'ni';

    /** Uisce Éireann and NI Water notices together, in one shape. Rebuilt whenever data loads. */
    function combineWater() {
        const notices = [...(data.water?.notices || []), ...(data.niwater?.notices || [])];
        const byCounty = {};
        for (const src of [data.water?.counties, data.niwater?.counties]) {
            for (const [id, c] of Object.entries(src || {})) {
                const t = byCounty[id] || (byCounty[id] = { active: 0, upcoming: 0, boilWater: 0, doNotDrink: 0 });
                for (const k of Object.keys(t)) t[k] += c[k] || 0;
            }
        }
        data.waterAll = data.water || data.niwater ? { notices, counties: byCounty } : null;
    }

    const per1000 = (n, id) => {
        const pop = data.population?.counties?.[id]?.population;
        return n == null || !pop ? null : 1000 * n / pop;
    };
    const dayName = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Dublin' });
    const euroL = n => n == null ? '–' : '€' + n.toFixed(3);
    const monthName = label => String(label || '').replace(/^(\d{4}) (\w+)$/, '$2 $1');   // CSO "2026 September" -> "September 2026"
    const AQI_BANDS = [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']];
    const aqiBand = v => AQI_BANDS.find(([max]) => v <= max)[1];

    /** A small line chart: series = [{ values, colour, label }] sharing one x axis; labels = [left, right] under it. */
    function spark(series, { height = 64, labels = [], unit = '', min = null } = {}) {
        const all = series.flatMap(s => s.values).filter(v => v != null);
        if (all.length < 2) return '';
        const lo = min ?? Math.min(...all);
        const hi = Math.max(...all);
        const span = hi - lo || 1;
        const w = 300;
        const n = Math.max(...series.map(s => s.values.length));
        const points = values => values
            .map((v, i) => v == null ? null : `${(i / (n - 1) * w).toFixed(1)},${(height - 4 - (v - lo) / span * (height - 8)).toFixed(1)}`)
            .filter(Boolean).join(' ');
        const num = v => (Math.abs(v) >= 100 ? fmt(Math.round(v)) : String(Math.round(v * 100) / 100));
        return `<figure class="spark">
            <svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map(s => s.label).join(' and '))}, ${esc(num(lo))} to ${esc(num(hi))}${esc(unit)}">
                ${series.map(s => `<polyline points="${points(s.values)}" fill="none" stroke="${s.colour}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`).join('')}
            </svg>
            <figcaption><span>${esc(labels[0] || '')}</span>
                <span class="spark-key">${series.map(s => `<span><i style="background:${s.colour}"></i>${esc(s.label)}</span>`).join('')}</span>
                <span>${esc(labels[1] || '')}</span></figcaption>
            <div class="spark-range">Range ${esc(num(lo))}–${esc(num(hi))}${esc(unit)}</div>
        </figure>`;
    }

    // ---------- Sun and moon (calculated, no data source) ----------
    // The standard low-precision formulas (as in the SunCalc library): accurate to a minute or two,
    // which is plenty for sunrise, sunset and how much of the moon is lit.
    const astro = (() => {
        const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
        const toDays = date => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
        const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
        const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
        const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
        const meanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
        const eclipticLongitude = M => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
        const sunCoords = d => { const L = eclipticLongitude(meanAnomaly(d)); return { dec: declination(L, 0), ra: rightAscension(L, 0) }; };
        const moonCoords = d => {
            const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
            const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
            return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
        };

        /** Times for one day at a place: angles in degrees below the horizon. NaN-dates mean it never happens. */
        function sunTimes(date, lat, lng) {
            const lw = rad * -lng, phi = rad * lat, d = toDays(date);
            const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
            const ds = 0.0009 + lw / (2 * Math.PI) + n;
            const M = meanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
            const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
            const at = h => {
                const w = Math.acos((Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
                const Jset = J2000 + (0.0009 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
                return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
            };
            const sun = at(-0.833), civil = at(-6), astronomical = at(-18);
            return { noon: fromJulian(Jnoon), sunrise: sun.rise, sunset: sun.set, dusk: civil.set, dawn: civil.rise, night: astronomical.set, nightEnd: astronomical.rise };
        }

        /** fraction lit (0–1) and phase (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter). */
        function moon(date) {
            const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
            const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
            const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
            const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
            const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
            const names = [[0.03, 'New moon'], [0.22, 'Waxing crescent'], [0.28, 'First quarter'], [0.47, 'Waxing gibbous'], [0.53, 'Full moon'],
                [0.72, 'Waning gibbous'], [0.78, 'Last quarter'], [0.97, 'Waning crescent'], [1.01, 'New moon']];
            return { fraction: (1 + Math.cos(inc)) / 2, phase, name: names.find(([max]) => phase <= max)[1] };
        }

        return { sunTimes, moon };
    })();

    const hhmm = d => d instanceof Date && !Number.isNaN(d.getTime())
        ? d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' }) : null;
    const hoursMins = ms => `${Math.floor(ms / 3600000)} hr ${Math.round((ms % 3600000) / 60000)} min`;

    /** Sun and moon for a place today: a short block of HTML. */
    function skyHtml(lat, lng) {
        const now = new Date();
        const t = astro.sunTimes(now, lat, lng);
        const m = astro.moon(now);
        const dark = hhmm(t.night);
        return `<div class="row"><span class="big">${esc(hhmm(t.sunrise))}</span><span class="soft">sunrise</span>
                <span class="big">${esc(hhmm(t.sunset))}</span><span class="soft">sunset</span></div>
            <p class="soft">${esc(hoursMins(t.sunset - t.sunrise))} of daylight · light until about ${esc(hhmm(t.dusk))}
            · ${dark ? `fully dark from ${esc(dark)}` : 'it never gets fully dark tonight'}</p>
            <p class="muted">${esc(m.name)}, ${esc(Math.round(m.fraction * 100))}% lit${m.fraction > 0.6 ? '. Bright moonlight washes out faint aurora and stars' : m.fraction < 0.25 ? '. Dark skies, good for stars and aurora' : ''}.
            Calculated for today, not from a data feed.</p>`;
    }

    function ago(iso) {
        const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (!Number.isFinite(mins)) return '';
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min ago`;
        const hours = Math.round(mins / 60);
        return hours < 48 ? `${hours} hr ago` : `${Math.round(hours / 24)} days ago`;
    }

    function when(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' });
    }

    /** Interpolate between colour stops: stops = [[value, '#rrggbb'], ...] */
    function ramp(stops, value) {
        if (value == null || Number.isNaN(value)) return null;
        if (value <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
            if (value <= stops[i][0]) {
                const [v0, c0] = stops[i - 1];
                const [v1, c1] = stops[i];
                const t = (value - v0) / (v1 - v0);
                const a = c0.match(/\w\w/g).map(h => parseInt(h, 16));
                const b = c1.match(/\w\w/g).map(h => parseInt(h, 16));
                return '#' + a.map((x, k) => Math.round(x + (b[k] - x) * t).toString(16).padStart(2, '0')).join('');
            }
        }
        return stops[stops.length - 1][1];
    }

    // ---------- Views: how counties are coloured ----------

    const WARNING_COLOURS = { yellow: '#f2c418', orange: '#ef8a1f', red: '#d7263d' };

    const VIEWS = {
        warnings: {
            label: 'Warnings', allIsland: true,
            value: id => data.warnings?.counties?.[id]?.level || null,
            colour: v => WARNING_COLOURS[v] || '#9fd3bd',
            describe: v => v ? `${v[0].toUpperCase() + v.slice(1)} warning` : 'No warnings',
            legend: () => `<div class="legend-title">Weather warnings</div>`
                + [['#9fd3bd', 'None'], [WARNING_COLOURS.yellow, 'Yellow'], [WARNING_COLOURS.orange, 'Orange'], [WARNING_COLOURS.red, 'Red']]
                    .map(([c, l]) => `<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${l}</div>`).join('')
        },
        temperature: {
            label: 'Temperature', allIsland: true,
            stops: [[-2, '2c5fd6'], [6, '7fb8e8'], [12, 'f4e3a1'], [18, 'f39a4a'], [26, 'c9302c']],
            value: id => data.weather?.counties?.[id]?.temperature,
            describe: v => v == null ? 'No data' : `${v.toFixed(1)}°C now`,
            ends: ['-2°C', '26°C'], title: 'Temperature now'
        },
        rain: {
            label: 'Rain today', allIsland: true,
            stops: [[0, 'f1f6f9'], [2, 'b9d7ef'], [8, '5c9fd8'], [20, '1f4f9e']],
            value: id => data.weather?.counties?.[id]?.todayRain,
            describe: v => v == null ? 'No data' : `${v.toFixed(1)} mm rain today`,
            ends: ['0 mm', '20+ mm'], title: 'Rain today (forecast total)'
        },
        prices: {
            label: 'House prices',
            stops: [[150000, 'efe7f6'], [250000, 'c6aee4'], [350000, '8d6cc9'], [500000, '4b2a8f']],
            value: id => data.housing?.counties?.[id]?.median,
            describe: v => v == null ? 'No data' : `Median ${euro(v)}`,
            ends: ['€150k', '€500k+'], title: 'Median house price, last 12 months'
        },
        change: {
            label: 'Price change',
            stops: [[-8, '2b7bba'], [0, 'f2f2f2'], [8, 'd7301f']],
            value: id => data.housing?.counties?.[id]?.change,
            describe: v => v == null ? 'No data' : `${pct(v)} in a year`,
            ends: ['-8%', '+8%'], title: 'House price change on previous year'
        },
        density: {
            label: 'Population',
            stops: [[1.3, 'f3efe3'], [2, 'd9c59a'], [2.6, 'b88a3e'], [3.3, '6e4a12']],
            value: id => data.population?.counties?.[id]?.density,
            transform: v => v ? Math.log10(v) : null,
            describe: v => v == null ? 'No data' : `${fmt(v)} people per km²`,
            ends: ['20 /km²', '2,000 /km²'], title: 'Population density (Census 2022)'
        },
        air: {
            label: 'Air quality', allIsland: true,
            stops: [[10, '50c1a8'], [30, 'e8d84d'], [50, 'ef8a1f'], [80, 'c9302c'], [100, '7d1d6b']],
            value: id => data.airquality?.counties?.[id]?.aqi,
            describe: v => v == null ? 'No data' : `Air quality ${aqiBand(v).toLowerCase()} (index ${v})`,
            ends: ['Good', 'Very poor'], title: 'European Air Quality Index (model estimate)'
        },
        trolleyView: {
            label: 'Trolleys',
            stops: [[0, 'f3f0ef'], [5, 'f2c4b4'], [15, 'e0745a'], [35, '9e1b1b']],
            value: id => data.trolleys ? (data.trolleys.counties[id]?.total ?? null) : null,
            describe: v => v == null ? 'No acute hospital reporting' : `${v} patient${v === 1 ? '' : 's'} on trolleys`,
            ends: ['0', '35+'], title: 'Patients on trolleys at 8am (HSE TrolleyGAR)'
        },
        rent: {
            label: 'Rent',
            stops: [[1000, 'f1ecf7'], [1300, 'cdb7e6'], [1700, '9a72c9'], [2300, '552a8f']],
            value: id => data.rents?.counties?.[id]?.rent,
            describe: v => v == null ? 'No data' : `Average rent €${fmt(v)} a month`,
            ends: ['€1,000', '€2,300+'], title: 'Average monthly rent, new tenancies (RTB)'
        },
        homes: {
            label: 'New homes',
            stops: [[3, 'eef2f8'], [6, 'b6c8e6'], [10, '5f86c4'], [14, '23427f']],
            value: id => per1000(data.economy?.counties?.[id]?.newHomes, id),
            describe: v => v == null ? 'No data' : `${v.toFixed(1)} new homes per 1,000 people in a year`,
            ends: ['3', '14+ per 1,000'], title: 'New homes completed in the last year, per 1,000 people'
        },
        waterView: {
            label: 'Water notices', allIsland: true,
            stops: [[0, 'eef4f8'], [1, 'bcd9ee'], [4, '5b9bd5'], [10, '1d4e89']],
            value: id => {
                const c = data.waterAll?.counties?.[id];
                return c ? c.active + c.upcoming : 0;
            },
            describe: v => `${v || 0} water notice${v === 1 ? '' : 's'}`,
            ends: ['0', '10+'], title: 'Uisce Éireann notices, now and next 7 days'
        }
    };

    function colourFor(id) {
        const v = VIEWS[view];
        const raw = v.value(id);
        if (v.colour) return v.colour(raw);
        const value = v.transform ? v.transform(raw) : raw;
        return value == null ? '#d6dbd8' : ramp(v.stops.map(([s, c]) => [s, '#' + c]), value);
    }

    let legendOpen = null;   // remembered while the page is open; null until first drawn

    function renderLegend() {
        const v = VIEWS[view];
        const el = document.getElementById('legend');
        let html;
        if (v.legend) html = v.legend();
        else {
            const gradient = v.stops.map(([, c], i) => `#${c} ${Math.round(100 * i / (v.stops.length - 1))}%`).join(', ');
            html = `<div class="legend-title">${esc(v.title)}</div>
                <div class="legend-ramp" style="background:linear-gradient(90deg, ${gradient})"></div>
                <div class="legend-ends"><span>${esc(v.ends[0])}</span><span>${esc(v.ends[1])}</span></div>`;
        }
        // A key for each dot layer that's switched on
        const keys = Object.entries(DOT_KEYS).filter(([name]) => overlays[name]);
        if (keys.length) {
            html += `<details class="legend-dots"${keys.length <= 2 ? ' open' : ''}><summary>Dots on the map</summary>${keys.map(([name, rows]) => `
                <div class="legend-sub">${esc(OVERLAYS[name].label)}</div>
                ${rows.map(([colour, text, ring]) => `<div class="legend-row"><span class="legend-dot" style="background:${colour}${ring ? `;box-shadow:0 0 0 2px ${ring}` : ''}"></span>${esc(text)}</div>`).join('')}`).join('')}</details>`;
        }
        // On phones the key starts folded into a small "Key" button so it doesn't cover the map
        if (legendOpen === null) legendOpen = !window.matchMedia('(max-width: 560px)').matches;
        el.innerHTML = `<details class="legend-box"${legendOpen ? ' open' : ''}><summary>Key</summary>${html}</details>`;
        el.querySelector('.legend-box').addEventListener('toggle', e => { legendOpen = e.target.open; });
    }

    // ---------- Map ----------

    // minZoom 5 so the whole island fits on a phone
    // Canvas rendering copes far better than SVG with ~700 bus markers
    // Touch screens: one finger scrolls the page, two fingers move and zoom the map (pinching pans too).
    // Mouse: the scroll wheel only zooms once you've clicked the map, so scrolling the page doesn't get stuck.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const map = L.map('map', {
        preferCanvas: true, zoomSnap: 0.25, minZoom: 5, maxZoom: 14, zoomControl: true,
        scrollWheelZoom: false, dragging: !coarse, tap: false
    }).setView([53.4, -8.0], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    function styleCounty(feature) {
        const id = feature.properties.id;
        return {
            fillColor: colourFor(id),
            fillOpacity: 0.62,
            color: id === selected ? '#14211c' : '#ffffff',
            weight: id === selected ? 3 : 1.2
        };
    }

    function restyle() {
        countyLayer?.setStyle(styleCounty);
        if (selected) countyLayer?.eachLayer(l => { if (l.feature.properties.id === selected) l.bringToFront(); });
        // Dots back on top of the (raised) selected county; layer groups have no bringToFront of their own
        Object.values(overlayLayers).forEach(g => g.eachLayer?.(m => m.bringToFront?.()));
    }

    function drawCounties() {
        countyLayer = L.geoJSON({ type: 'FeatureCollection', features: counties }, {
            style: styleCounty,
            onEachFeature: (feature, layer) => {
                const id = feature.properties.id;
                layer.bindTooltip(() => {
                    const v = VIEWS[view].value(id);
                    const text = v == null && isNI(id) && !VIEWS[view].allIsland ? 'Not covered in Northern Ireland' : VIEWS[view].describe(v);
                    return `${esc(feature.properties.name)}<br><span class="popup-meta">${esc(text)}</span>`;
                },
                    { sticky: true, className: 'county-tip', direction: 'top', offset: [0, -6] });
                layer.on({
                    mouseover: e => e.target.setStyle({ weight: 2.5, color: '#14211c' }),
                    mouseout: () => restyle(),
                    click: e => mapClick(e, id)
                });
            },
            // The map's own click handler would otherwise run a second time for the same click
            bubblingMouseEvents: false
        }).addTo(map);
        fitIreland();
    }

    // The controls above the map wrap differently by screen width, so measure the map after layout
    // When the page opens on a shared link to a county, the first fit goes straight to that county
    let firstFocus = null;
    function fitIreland() {
        requestAnimationFrame(() => {
            map.invalidateSize();
            let bounds = countyLayer.getBounds();
            if (firstFocus) countyLayer.eachLayer(l => { if (l.feature.properties.id === firstFocus) bounds = l.getBounds(); });
            firstFocus = null;
            map.fitBounds(bounds, { padding: [10, 10] });
        });
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => map.invalidateSize(), 200);
    });

    // ---------- Clicking and tapping the map ----------

    // Popups keep clear of the zoom and ⟲/◎ buttons in the top-left corner
    // On phones a popup must fit beside those buttons, so cap its width to the screen
    const POPUP = { maxWidth: Math.min(320, window.innerWidth - 150), autoPanPaddingTopLeft: L.point(56, 12), autoPanPaddingBottomRight: L.point(12, 12) };

    // How far from a dot (in screen pixels, beyond its own size) a click still counts as hitting it
    const HIT_SLOP = coarse ? 14 : 7;

    /** Every visible dot near a screen point, nearest first. */
    function pointsNear(containerPoint) {
        const found = [];
        for (const [name, group] of Object.entries(overlayLayers)) {
            if (!overlays[name] || !map.hasLayer(group)) continue;
            group.eachLayer(m => {
                if (!m.info) return;
                const p = map.latLngToContainerPoint(m.getLatLng());
                const reach = (m.getRadius ? m.getRadius() : 11) + HIT_SLOP;
                const d = p.distanceTo(containerPoint);
                if (d <= reach) found.push({ m, d, overlay: name });
            });
        }
        return found.sort((a, b) => a.d - b.d);
    }

    function openPoint(m) {
        L.popup(POPUP).setLatLng(m.getLatLng()).setContent(m.info.html).openOn(map);
    }

    let pickList = [];

    /** One dot: open it. Several: a short list to choose from. None: the county (if any) underneath. */
    function mapClick(e, countyId) {
        const near = pointsNear(e.containerPoint);
        if (near.length === 1) return openPoint(near[0].m);
        if (near.length > 1) {
            pickList = near.slice(0, 8).map(n => n.m);
            L.popup(POPUP).setLatLng(e.latlng).setContent(`<div class="pick-title">${near.length} here, choose one</div>
                <ul class="pick-list">${pickList.map((m, i) => `<li><button type="button" data-pick="${i}">
                    <span class="dot" style="background:${m.info.colour}"></span><strong>${esc(m.info.title)}</strong>
                    <span class="popup-meta">${esc(m.info.type)}</span></button></li>`).join('')}</ul>
                ${near.length > 8 ? `<p class="popup-meta">and ${near.length - 8} more. Zoom in to separate them.</p>` : ''}`).openOn(map);
            return;
        }
        if (countyId) {
            selectCounty(countyId, { from: 'map' });
            showTownland(e.latlng, countyId);
        }
    }
    map.on('click', e => mapClick(e, null));   // clicks on the sea, e.g. near a buoy or offshore quake
    map.on('popupopen', e => {
        e.popup.getElement()?.addEventListener('click', ev => {
            const b = ev.target.closest('[data-pick]');
            if (b && pickList[b.dataset.pick]) openPoint(pickList[b.dataset.pick]);
        });
    });

    /**
     * Turn each overlay dot's popup into click-anywhere-near behaviour: keep its content, a title and
     * colour for the pick list, and route its own clicks through mapClick (so a dot never selects the county).
     */
    function wireDots(group, label, fallbackColour) {
        group.eachLayer(m => {
            const popup = m.getPopup?.();
            if (!popup) return;
            const html = popup.getContent();
            m.unbindPopup();
            // The popup HTML is already escaped, so read the title back as plain text (it's escaped again when shown)
            const strong = (String(html).match(/<strong>([\s\S]*?)<\/strong>/) || [])[1];
            const title = strong ? new DOMParser().parseFromString(strong, 'text/html').body.textContent.trim() : label;
            m.info = { html, title, type: label, colour: m.options.fillColor || fallbackColour };
            if (m.options) m.options.bubblingMouseEvents = false;
            m.on('click', ev => mapClick(ev, null));
        });
    }

    // Scroll-wheel zoom only after the map is clicked; a hint explains when the wheel is ignored
    const mapEl = document.getElementById('map');
    const hint = L.DomUtil.create('div', 'map-hint', mapEl);
    let hintTimer;
    function showHint(text) {
        hint.textContent = text;
        hint.classList.add('show');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => hint.classList.remove('show'), 1600);
    }
    map.on('click focus', () => map.scrollWheelZoom.enable());
    mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    mapEl.addEventListener('wheel', () => { if (!map.scrollWheelZoom.enabled()) showHint('Click the map first to zoom with the scroll wheel'); }, { passive: true });
    if (coarse) {
        mapEl.addEventListener('touchmove', e => { if (e.touches.length === 1) showHint('Use two fingers to move the map'); }, { passive: true });
    }

    // ---------- Reset view and my location ----------

    function resetView() {
        map.closePopup();
        placeMarker?.remove();
        placeMarker = null;
        fitIreland();
    }

    let youMarker = null;
    function locateMe(button) {
        if (!navigator.geolocation) return showHint('This browser can’t share your location');
        button.classList.add('busy');
        navigator.geolocation.getCurrentPosition(pos => {
            button.classList.remove('busy');
            const { latitude: lat, longitude: lon, accuracy } = pos.coords;
            const id = countyAtPoint(lon, lat);
            if (!id) return showHint('You seem to be outside Ireland, so the map stays where it is');
            youMarker?.remove();
            youMarker = L.layerGroup([
                L.circle([lat, lon], { radius: Math.min(accuracy, 3000), color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }),
                L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false })
            ]).addTo(map);
            map.setView([lat, lon], 12);
            selectCounty(id, { from: 'map' });
            showTownland(L.latLng(lat, lon), id);
        }, err => {
            button.classList.remove('busy');
            showHint(err.code === err.PERMISSION_DENIED ? 'Location is turned off for this site' : 'Couldn’t find your location just now');
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    }

    /** Which county a point is in (outer rings only: county shapes have no holes worth worrying about). */
    function countyAtPoint(lon, lat) {
        const inRing = ring => {
            let inside = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i], [xj, yj] = ring[j];
                if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        };
        return counties.find(f => f.geometry.coordinates.some(rings => inRing(rings[0])))?.properties.id || null;
    }

    const MapButtons = L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const box = L.DomUtil.create('div', 'leaflet-bar map-buttons');
            box.innerHTML = `<a href="#" role="button" data-map="reset" title="Show the whole island" aria-label="Show the whole island">⟲</a>
                <a href="#" role="button" data-map="locate" title="Show where I am (your location stays in your browser)" aria-label="Show where I am">◎</a>`;
            L.DomEvent.disableClickPropagation(box);
            L.DomEvent.on(box, 'click', e => {
                const a = e.target.closest('[data-map]');
                if (!a) return;
                e.preventDefault();
                if (a.dataset.map === 'reset') resetView(); else locateMe(a);
            });
            return box;
        }
    });
    new MapButtons().addTo(map);

    // On phones the panel sits below the map: after tapping a county, offer to go there instead of jumping
    const viewBtn = L.DomUtil.create('button', 'map-view-county', mapEl);
    viewBtn.type = 'button';
    viewBtn.addEventListener('click', () => {
        viewBtn.classList.remove('show');
        document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    L.DomEvent.disableClickPropagation(viewBtn);

    /** Fit the map to one county */
    function zoomToCounty(id) {
        countyLayer?.eachLayer(l => {
            if (l.feature.properties.id === id) map.flyToBounds(l.getBounds(), { padding: [24, 24], duration: 0.6 });
        });
    }

    // ---------- Overlays ----------

    const TREND_COLOURS = { 'rising-fast': '#d7263d', rising: '#ef8a1f', steady: '#3d7ea6', falling: '#1f8a5b', unknown: '#7c8b85' };
    const WATER_COLOURS = { 'do-not-drink': '#a4132a', 'boil-water': '#d7263d', restrictions: '#ef8a1f', outage: '#2f6fd6', 'low-pressure': '#5b9bd5', discolouration: '#8d6cc9', works: '#7c8b85' };
    const WATER_LABELS = { 'do-not-drink': 'Do not drink', 'boil-water': 'Boil water', restrictions: 'Restrictions', outage: 'Supply interruption', 'low-pressure': 'Low pressure', discolouration: 'Discolouration', works: 'Works' };

    const OVERLAYS = {
        water: {
            label: 'Water notices', colour: '#2f6fd6',
            build: () => L.layerGroup((data.waterAll?.notices || []).filter(n => n.lat != null).map(n =>
                L.circleMarker([n.lat, n.lon], {
                    radius: n.active ? 6 : 4.5, weight: 1.5, color: '#fff',
                    fillColor: WATER_COLOURS[n.kind] || '#2f6fd6', fillOpacity: n.active ? 0.95 : 0.55
                }).bindPopup(`<strong>${esc(n.title)}</strong><br>
                    <span class="pill">${esc(WATER_LABELS[n.kind] || n.kind)}</span>${n.active ? '<span class="pill warn">Now</span>' : '<span class="pill">Upcoming</span>'}<br>
                    <span class="popup-meta">${n.issuer === 'NI Water'
                        ? `Updated ${esc(when(n.updated))}${n.end ? ` · expected back ${esc(when(n.end))}` : ''}`
                        : `${esc(when(n.start))} to ${esc(when(n.end))}`}</span>
                    <p style="margin-top:6px">${esc(n.description.slice(0, 280))}${n.description.length > 280 ? '…' : ''}</p>
                    ${n.issuer === 'NI Water'
                        ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">NI Water service updates</a>`
                        : '<a href="https://www.water.ie/water-service-updates" target="_blank" rel="noopener">Uisce Éireann updates</a>'}`)
            ))
        },
        stations: {
            label: 'Weather stations', colour: '#6b4fbb',
            build: () => L.layerGroup((data.observations?.stations || []).filter(s => s.temperature != null).map(s =>
                L.marker([s.lat, s.lon], {
                    icon: L.divIcon({ className: 'temp-marker', html: `<span>${Math.round(s.temperature)}°</span>`, iconSize: [34, 22], iconAnchor: [17, 11] }),
                    keyboard: false
                }).bindPopup(`<strong>${esc(s.name)}</strong> <span class="popup-meta">Met Éireann station</span><br>
                    ${esc(s.temperature)}°C${s.description ? `, ${esc(s.description.trim())}` : ''}<br>
                    Wind ${esc(s.windKmh ?? '–')} km/h ${esc(s.windDirection || '')}${s.gustKmh ? `, gusts ${esc(s.gustKmh)} km/h` : ''}<br>
                    Rain today ${esc(s.rainToday)} mm · humidity ${esc(s.humidity ?? '–')}%<br>
                    <span class="popup-meta">Reported at ${esc(s.time)}</span>`)
            ))
        },
        rivers: {
            label: 'Rivers', colour: '#3d7ea6',
            build: () => L.layerGroup((data.rivers?.stations || []).map(s =>
                L.circleMarker([s.lat, s.lon], {
                    radius: s.trend.startsWith('rising') ? 6 : 4, weight: 1, color: '#fff',
                    fillColor: TREND_COLOURS[s.trend], fillOpacity: 0.9
                }).bindPopup(`<strong>${esc(s.name)}</strong><br>
                    Level ${esc(s.level.toFixed(2))} m${s.change != null ? ` · <span class="trend ${s.change > 0 ? 'up' : 'down'}">${s.change > 0 ? '+' : ''}${(s.change * 100).toFixed(0)} cm in 6 hrs</span>` : ''}<br>
                    <span class="popup-meta">${esc(s.trend === 'unknown' ? 'Trend appears after a few hours of readings' : s.trend.replace('-', ' '))} · ${esc(when(s.time))}</span><br>
                    <a href="${esc(s.url)}" target="_blank" rel="noopener">waterlevel.ie</a>`)
            ))
        },
        tides: {
            label: 'Tides', colour: '#1aa3a3',
            build: () => L.layerGroup((data.tides?.gauges || []).map(g =>
                L.circleMarker([g.lat, g.lon], { radius: 6, weight: 2, color: '#1aa3a3', fillColor: '#fff', fillOpacity: 1 })
                    .bindPopup(`<strong>${esc(g.name)}</strong><br>${esc(g.level.toFixed(2))} m above lowest astronomical tide<br>
                        <span class="popup-meta">Tide ${esc(g.direction)} · ${esc(when(g.time))}</span>`)
            ))
        },
        buoys: {
            label: 'Sea buoys', colour: '#0e7490',
            build: () => L.layerGroup((data.marine?.buoys || []).map(b =>
                L.circleMarker([b.lat, b.lon], { radius: 7, weight: 3, color: '#0e7490', fillColor: '#f5d90a', fillOpacity: 1 })
                    .bindPopup(`<strong>${esc(b.name)}</strong> <span class="popup-meta">${esc(b.place)}</span><br>
                        Waves ${esc(b.waveHeight ?? '–')} m, every ${esc(b.wavePeriod ?? '–')} s<br>
                        Wind ${esc(b.windKmh ?? '–')} km/h${b.gustKmh ? `, gusts ${esc(b.gustKmh)} km/h` : ''}<br>
                        Sea ${esc(b.seaTemperature ?? '–')}°C · air ${esc(b.airTemperature ?? '–')}°C · ${esc(b.pressure ?? '–')} hPa<br>
                        <span class="popup-meta">${esc(when(b.time))}</span>`)
            ))
        },
        quakes: {
            label: 'Earthquakes', colour: '#c2410c',
            build: () => L.layerGroup((data.earthquakes?.quakes || []).map(q =>
                L.circleMarker([q.lat, q.lon], {
                    radius: 4 + Math.max(0, q.magnitude ?? 0) * 3, weight: 1.5, color: '#9a3412', fillColor: '#f97316', fillOpacity: 0.45
                }).bindPopup(`<strong>Magnitude ${esc(q.magnitude ?? '?')}</strong> · ${esc(q.depthKm ?? '?')} km deep<br>
                    ${esc(when(q.time))}<br><span class="popup-meta">${esc(q.region)} · recorded by ${esc(q.agency)}</span><br>
                    <a href="${esc(q.url)}" target="_blank" rel="noopener">EMSC details</a>`)
            ))
        },
        trains: {
            label: 'Trains', colour: '#1f8a5b',
            build: () => L.layerGroup((data.trains?.trains || []).map(t => {
                const late = t.minutesLate || 0;
                return L.circleMarker([t.lat, t.lon], {
                    radius: 6, weight: 2, color: '#fff',
                    fillColor: late >= 10 ? '#d7263d' : late >= 5 ? '#ef8a1f' : '#1f8a5b', fillOpacity: 0.95
                }).bindPopup(`<strong>${esc(t.route || t.direction)}</strong><br>${esc(t.progress)}<br>
                    <span class="popup-meta">${esc(t.code)} · ${late > 0 ? `${late} min late` : 'On time'} · position at last update</span>`);
            }))
        },
        buses: {
            label: 'Buses', colour: '#c2410c',
            build: () => L.layerGroup((data.buses?.buses || []).map(b => {
                const late = b.minutesLate;
                return L.circleMarker([b.lat, b.lon], {
                    radius: 4, weight: 1, color: '#fff',
                    fillColor: late == null ? '#7c8b85' : late >= 10 ? '#d7263d' : late >= 5 ? '#ef8a1f' : '#c2410c', fillOpacity: 0.9
                }).bindPopup(`<strong>${esc(b.route)}</strong> ${esc(b.name)}<br>${esc(b.operator)}<br>
                    <span class="popup-meta">${late == null ? 'No delay information' : late > 0 ? `${late} min late` : late < 0 ? `${-late} min early` : 'On time'} · position at last update</span>`);
            }))
        },
        luas: {
            label: 'Luas stops', colour: '#d7263d',
            build: () => L.layerGroup((data.luas?.stops || []).map(s => {
                const line = data.luas.lines?.[s.line];
                return L.circleMarker([s.lat, s.lon], {
                    radius: 4.5, weight: 1, color: '#fff',
                    fillColor: s.line === 'green' ? '#1f8a5b' : '#d7263d', fillOpacity: 0.95
                }).bindPopup(`<strong>${esc(s.name)}</strong> <span class="popup-meta">${esc(line?.name || (s.line === 'green' ? 'Green Line' : 'Red Line'))}</span><br>
                    ${line ? esc(line.message) : ''}<br>
                    <a href="https://luas.ie/" target="_blank" rel="noopener">Live times on luas.ie</a>`);
            }))
        }
    };

    // What each dot colour means: [colour, label, optional ring colour]
    const DOT_KEYS = {
        water: [['#d7263d', 'Boil water / do not drink'], ['#ef8a1f', 'Restrictions'], ['#2f6fd6', 'Supply interruption'], ['#7c8b85', 'Works, other']],
        stations: [['#6b4fbb', 'Temperature measured now']],
        rivers: [['#d7263d', 'Rising fast (30 cm+ in 6 hrs)'], ['#ef8a1f', 'Rising (10 cm+)'], ['#3d7ea6', 'Steady'], ['#1f8a5b', 'Falling'], ['#7c8b85', 'Trend not known yet']],
        tides: [['#fff', 'Tide gauge', '#1aa3a3']],
        buoys: [['#f5d90a', 'Weather buoy', '#0e7490']],
        quakes: [['#f97316', 'Bigger circle = bigger quake']],
        trains: [['#1f8a5b', 'On time'], ['#ef8a1f', '5+ min late'], ['#d7263d', '10+ min late']],
        buses: [['#c2410c', 'On time'], ['#ef8a1f', '5+ min late'], ['#d7263d', '10+ min late'], ['#7c8b85', 'No delay information']],
        luas: [['#d7263d', 'Red Line stop'], ['#1f8a5b', 'Green Line stop']]
    };

    const DOT_NAMES = { water: 'Water notice', stations: 'Weather station', rivers: 'River gauge', tides: 'Tide gauge', buoys: 'Sea buoy', quakes: 'Earthquake', trains: 'Train', buses: 'Bus', luas: 'Luas stop' };

    function drawOverlays() {
        for (const [name, def] of Object.entries(OVERLAYS)) {
            overlayLayers[name]?.remove();
            overlayLayers[name] = def.build();
            wireDots(overlayLayers[name], DOT_NAMES[name] || def.label, def.colour);
            if (overlays[name]) overlayLayers[name].addTo(map);
        }
    }

    // ---------- Controls ----------

    function renderControls() {
        document.getElementById('views').innerHTML = Object.entries(VIEWS).map(([key, v]) =>
            `<button class="chip" role="radio" aria-checked="${key === view}" data-view="${key}">${esc(v.label)}</button>`).join('');
        document.getElementById('overlays').innerHTML = Object.entries(OVERLAYS).map(([key, o]) =>
            `<button class="chip" aria-pressed="${overlays[key]}" data-overlay="${key}"><span class="dot" style="background:${o.colour}"></span>${esc(o.label)}</button>`).join('');
    }

    document.addEventListener('click', e => {
        const v = e.target.closest('[data-view]');
        if (v) {
            view = v.dataset.view;
            renderControls(); renderLegend(); restyle(); updateHash();
        }
        const o = e.target.closest('[data-overlay]');
        if (o) {
            const key = o.dataset.overlay;
            overlays[key] = !overlays[key];
            overlays[key] ? overlayLayers[key].addTo(map) : overlayLayers[key].remove();
            renderControls(); renderLegend(); updateHash();
        }
        if (e.target.closest('[data-cards]')) {
            const open = document.getElementById('national').classList.contains('collapsed');
            try { localStorage.setItem('cards-expanded', open ? '1' : '0'); } catch { /* private mode */ }
            renderNational();
            // The map's height depends on how much the cards take up
            setTimeout(() => map.invalidateSize(), 50);
        }
        const c = e.target.closest('[data-county]');
        if (c) { e.preventDefault(); selectCounty(c.dataset.county, { zoom: true, from: 'panel' }); }
        if (e.target.closest('[data-back]')) { e.preventDefault(); selectCounty(null); resetView(); }
    });

    // Shareable links: #county=limerick&view=prices&show=water,rivers
    function updateHash() {
        const params = new URLSearchParams();
        if (selected) params.set('county', selected);
        if (view !== 'warnings') params.set('view', view);
        params.set('show', Object.keys(overlays).filter(k => overlays[k]).join(','));
        history.replaceState(null, '', '#' + params.toString());
    }

    function readHash() {
        const params = new URLSearchParams(location.hash.slice(1));
        if (params.get('view') && VIEWS[params.get('view')]) view = params.get('view');
        if (params.has('show')) {
            const show = params.get('show').split(',');
            Object.keys(overlays).forEach(k => { overlays[k] = show.includes(k); });
        }
        return params.get('county');
    }

    // ---------- National strip ----------

    function renderNational() {
        const w = data.warnings?.warnings || [];
        const top = ['red', 'orange', 'yellow'].find(l => w.some(x => x.level === l));
        const g = data.grid?.national;
        const t = data.trains?.national;
        const water = data.waterAll?.notices || [];
        const rising = (data.rivers?.stations || []).filter(s => s.trend.startsWith('rising')).length;
        const h = data.housing?.national;
        const econ = data.economy?.national;
        const fuel = data.fuel?.national;
        const tr = data.trolleys;
        const sp = data.space?.national;
        const worstAir = data.airquality
            ? Object.entries(data.airquality.counties).filter(([, c]) => c.aqi != null).sort((a, b) => b[1].aqi - a[1].aqi)[0]
            : null;

        // How old each source's own data is (not when this site fetched it)
        // Live feeds carry no timestamp of their own, so the time we read them is their age
        const live = layer => data[layer] ? { text: `Live feed, checked ${clock(data[layer].updatedAt)}`, old: hoursOld(data[layer].updatedAt) > 2 } : null;
        const at = (iso, maxHours, prefix = 'Data from') => iso ? { text: `${prefix} ${clock(iso)}`, old: hoursOld(iso) > maxHours } : null;
        const onDate = (date, maxDays, prefix) => date ? { text: `${prefix} ${dayName(date)}${agoDays(date)}`, old: hoursOld(date + 'T12:00:00Z') > maxDays * 24 } : null;
        const forMonth = (label, maxDays) => {
            if (!label) return null;
            // A month's figures are "as of" the end of that month
            const [y, m] = [Number(label.slice(0, 4)), MONTHS.indexOf(label.slice(5)) + 1];
            const end = new Date(Date.UTC(y, m, 0, 12));
            return { text: `${monthName(label)} figures`, old: hoursOld(end.toISOString()) > maxDays * 24 };
        };

        const cards = [
            ['Weather warnings', w.length ? `${w.length} active` : 'None', top ? `Highest: ${top}` : 'Met Éireann', live('warnings')],
            ['Wind power', g?.windPercent != null ? `${g.windPercent}%` : '–', g ? `of demand · ${fmt(g.demandMW)} MW · ${fmt(g.co2)} gCO₂/kWh` : '', at(g?.sourceTime, 2, 'Reading at')],
            ['Trains running', t ? fmt(t.running) : '–', t ? `${t.late} running 5+ min late` : '', live('trains')],
            ['Buses tracked', data.buses ? fmt(data.buses.national.running) : '–', data.buses ? `${fmt(data.buses.national.late)} running 5+ min late` : '',
                data.buses?.sourceTime ? at(data.buses.sourceTime, 2, 'Positions at') : live('buses')],
            ['Water notices', fmt(water.filter(n => n.active).length), `${water.filter(n => !n.active).length} more due this week`, live('water')],
            ['Rivers rising', data.rivers ? fmt(rising) : '–', data.rivers ? `of ${fmt(data.rivers.stations.length)} gauges` : '', at(data.rivers?.sourceTime, 3, 'Latest reading')],
            ['House prices', h ? euro(h.median) : '–', h ? `${pct(h.change)} on last year` : '', onDate(data.housing?.latestSale, 30, 'Sales registered to')],
            ['On trolleys', tr ? fmt(tr.national.total) : '–', tr ? 'people waiting at 8am (HSE)' : '', onDate(tr?.reportDate, 4, 'Report of')],
            ['Petrol · diesel', fuel ? `${euroL(fuel.petrol)} · ${euroL(fuel.diesel)}` : '–', fuel ? 'per litre, national average' : '', onDate(fuel?.date, 14, 'Week of')],
            ['Unemployment', econ ? `${econ.unemployment.rate.toFixed(1)}%` : '–', econ ? `was ${econ.unemployment.yearAgo?.toFixed(1)}% a year before` : '', forMonth(econ?.unemployment.month, 45)],
            ['Inflation', econ ? `${econ.inflation.annual.toFixed(1)}%` : '–', econ ? 'rise in prices over a year' : '', forMonth(econ?.inflation.month, 45)],
            ['Air quality', worstAir ? worstAir[1].band : '–', worstAir ? `worst is ${nameOf(worstAir[0])}, index ${worstAir[1].aqi}` : '', at(data.airquality?.sourceTime, 3, 'Model estimate for')],
            ['Northern Lights', sp ? sp.aurora.text.split(':')[0].replace(/,.*/, '') : '–', sp ? `Kp ${sp.kp ?? '–'} now${sp.peakKp != null ? `, ${sp.peakKp} max next 24 hrs` : ''}` : '', at(sp?.kpTime, 6, 'Kp reading')]
        ];
        let expanded = false;
        try { expanded = localStorage.getItem('cards-expanded') === '1'; } catch { /* private mode */ }
        const strip = document.getElementById('national');
        strip.classList.toggle('collapsed', !expanded);
        strip.innerHTML = cards.map(([label, value, sub, note]) =>
            `<div class="stat"><div class="stat-label">${esc(label)} ${cardHelp(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div>
            ${note ? `<div class="stat-asof${note.old ? ' old' : ''}"${note.old ? ' title="Older than this source is usually updated"' : ''}>${note.old ? '⚠ ' : ''}${esc(note.text)}</div>` : ''}</div>`).join('')
            + `<button type="button" class="cards-toggle" data-cards aria-expanded="${expanded}">${expanded ? 'Show fewer ▴' : `Show all ${cards.length} ▾`}</button>`;
    }

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const hoursOld = iso => (Date.now() - new Date(iso).getTime()) / 3600000;
    const agoDays = date => {
        const days = Math.floor(hoursOld(date + 'T12:00:00Z') / 24);
        return days >= 2 ? ` (${days} days ago)` : '';
    };

    /** "21:15 today", "yesterday 21:15", or "Thu 29 Oct, 21:15", in Irish time. */
    function clock(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const fmtDay = x => x.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
        const time = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' });
        if (fmtDay(d) === fmtDay(new Date())) return `${time} today`;
        if (fmtDay(d) === fmtDay(new Date(Date.now() - 86400000))) return `yesterday ${time}`;
        if (d > new Date()) return `${time} ${d.toLocaleDateString('en-IE', { weekday: 'short', timeZone: 'Europe/Dublin' })}`;
        return `${d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Dublin' })}, ${time}`;
    }

    // ---------- County panel ----------

    function section(title, body, link) {
        return `<section class="section"><h3><span>${esc(title)}</span>${link ? `<a href="${esc(link[1])}" target="_blank" rel="noopener">${esc(link[0])} ↗</a>` : ''}</h3>${body}</section>`;
    }

    const unavailable = '<p class="empty">Not available right now.</p>';

    // ---------- How old figures are ----------

    /** A small "figures for … " line under a section; orange when older than the source usually is. */
    const asOf = (text, old = false) => `<p class="asof${old ? ' old' : ''}"${old ? ' title="Older than this source is usually updated"' : ''}>${old ? '⚠ ' : ''}${esc(text)}</p>`;
    const QUARTER_MONTHS = { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' };
    /** "2025Q4" -> "Oct–Dec 2025" */
    const quarterName = q => { const m = String(q || '').match(/^(\d{4})Q(\d)$/); return m ? `${QUARTER_MONTHS[m[2]]} ${m[1]}` : String(q || ''); };
    /** Days since the end of a quarter like "2025Q4" */
    const quarterAgeDays = q => {
        const m = String(q || '').match(/^(\d{4})Q(\d)$/);
        return m ? (Date.now() - Date.UTC(Number(m[1]), Number(m[2]) * 3, 1)) / 86400000 : 0;
    };
    const quarterSpan = (from, to) => {
        const a = String(from).match(/^(\d{4})Q(\d)$/), b = String(to).match(/^(\d{4})Q(\d)$/);
        if (!a || !b) return `${from} to ${to}`;
        const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${M[(a[2] - 1) * 3]} ${a[1]} to ${M[b[2] * 3 - 1]} ${b[1]}`;
    };
    const shortDate = iso => iso ? new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }) : 'date unknown';

    function censusHtml(id) {
        const c = data.census?.counties?.[id];
        if (!c) return '';
        const years = Math.floor((Date.now() - new Date(data.census.censusDate)) / (365.25 * 86400000));
        return `<ul class="list" style="margin-top:6px">
                <li>Age <span class="meta">${esc(c.under15)}% under 15 · ${esc(c.over65)}% aged 65 and over</span></li>
                <li>Irish <span class="meta">${esc(c.irishSpeakers)}% can speak Irish · ${esc(c.irishWell)}% speak it well or very well (aged 3+)</span></li>
                <li>Getting to work <span class="meta">${esc(c.commuteCar)}% by car · ${esc(c.commutePublic)}% bus or train · ${esc(c.commuteActive)}% walk or cycle</span></li>
            </ul>
            ${asOf(`Census taken ${shortDate(data.census.censusDate)} (${years} years ago). The next census is due in 2027.`)}`;
    }

    // ---------- Trend charts, loaded when a county is opened ----------

    const trendFiles = {};
    const loadTrend = path => trendFiles[path] || (trendFiles[path] = fetch(`data/${path}`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null));
    const dayLabel = iso => new Date(iso).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', timeZone: 'Europe/Dublin' });

    async function fillTrends() {
        for (const slot of document.querySelectorAll('#panel .trend-slot')) {
            if (slot.dataset.trend === 'station') {
                const rows = (await loadTrend('observations/history.json'))?.[slot.dataset.station];
                if (!rows || rows.length < 6) { slot.innerHTML = '<p class="muted">A week of readings builds up here over the next few days.</p>'; continue; }
                // Rain per day, to read alongside the hourly temperature
                const days = {};
                for (const [t, , rain] of rows) { const d = t.slice(0, 10); days[d] = (days[d] || 0) + (rain || 0); }
                const first = rows[0][0], last = rows[rows.length - 1][0];
                slot.innerHTML = `<div class="trend-title">Measured at ${esc(slot.dataset.name)}, ${esc(rows.length >= 24 * 6 ? 'last 7 days' : 'since ' + dayLabel(first))}</div>
                    ${spark([{ values: rows.map(r => r[1]), colour: '#c2410c', label: 'Temperature' }], { labels: [dayLabel(first), dayLabel(last)], unit: '°C' })}
                    <p class="muted">Rain: ${Object.entries(days).slice(-7).map(([d, mm]) => `${dayLabel(d + 'T12:00:00Z').split(' ')[0]} ${mm.toFixed(1)}`).join(' · ')} mm</p>
                    ${asOf(`Hourly readings to ${clock(last)}`, hoursOld(last) > 3)}`;
            } else if (slot.dataset.trend === 'rivers') {
                const file = await loadTrend(`rivers/${slot.dataset.county}.json`);
                const gauges = (slot.dataset.refs || '').split(';').filter(Boolean).map(x => x.split('|'))
                    .map(([ref, name]) => ({ name, rows: file?.[ref] || [] })).filter(g => g.rows.length >= 3);
                slot.innerHTML = gauges.map(g => `<div class="trend-title">${esc(g.name)}, ${Math.round(hoursOld(g.rows[0][0])) <= 1 ? 'last hour' : `last ${esc(Math.round(hoursOld(g.rows[0][0])))} hours`}</div>
                    ${spark([{ values: g.rows.map(r => r[1]), colour: '#3d7ea6', label: 'Level' }], { labels: [clock(g.rows[0][0]), clock(g.rows[g.rows.length - 1][0])], unit: ' m', height: 48 })}`).join('')
                    + (gauges.length ? asOf(`Gauge readings to ${clock(gauges[0].rows[gauges[0].rows.length - 1][0])}`, hoursOld(gauges[0].rows[gauges[0].rows.length - 1][0]) > 3) : '');
            }
        }
    }

    /** The county's own Met Éireann station (the first listed), or the nearest one to the county's middle. */
    function stationFor(id, feature) {
        const stations = data.observations?.stations || [];
        const own = stations.find(s => s.county === id && s.temperature != null);
        if (own) return own;
        const c = L.geoJSON(feature).getBounds().getCenter();
        const kx = Math.cos(c.lat * Math.PI / 180);
        let best = null;
        let bestD = Infinity;
        for (const s of stations) {
            if (s.temperature == null) continue;
            const d = ((s.lon - c.lng) * kx) ** 2 + (s.lat - c.lat) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    function countyPanel(id) {
        const f = counties.find(x => x.properties.id === id);
        const p = f.properties;
        const ni = isNI(id);
        let html = `<a href="#" data-back class="muted">← All of Ireland</a>
            <h2 style="margin-top:6px">${esc(p.name)}</h2><div class="irish">${esc(p.irish)} · ${esc(p.province)}${ni ? ' · Northern Ireland' : ''}</div>`;

        if (ni) {
            html += `<p class="ni-note">Weather, forecasts, air quality, Met Office warnings, NI Water, earthquakes and daylight cover Northern Ireland here.
                Most other sources on this site (CSO, HSE, property, TDs) cover the Republic only. For Northern Ireland see
                <a href="https://www.nisra.gov.uk/" target="_blank" rel="noopener">NISRA</a>,
                <a href="https://www.nidirect.gov.uk/" target="_blank" rel="noopener">nidirect</a> and
                <a href="https://www.translink.co.uk/" target="_blank" rel="noopener">Translink</a>.</p>`;
        }

        // Warnings
        if (data.warnings) {
            const list = data.warnings.warnings.filter(w => w.counties.includes(id));
            html += section('Weather warnings', list.length ? list.map(w => `
                <div class="warning ${esc(w.level)}"><strong>${esc(w.headline)}</strong>
                <span class="muted">${esc(when(w.onset))}${w.expiry ? ` to ${esc(when(w.expiry))}` : ''} · ${esc(w.issuer || 'Met Éireann')}</span>
                <p>${esc(w.description)}</p></div>`).join('') : '<p class="soft">No warnings in force.</p>',
                ni ? ['Met Office', 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings'] : ['met.ie', 'https://www.met.ie/warnings']);
        }

        // Weather
        const we = data.weather?.counties?.[id];
        const st = stationFor(id, f);
        html += section('Weather now', we ? `
            <div class="row"><span class="big">${esc(we.temperature.toFixed(1))}°C</span><span class="soft">${esc(we.description)}</span></div>
            <p class="soft">Wind ${esc(we.windSpeed)} km/h, gusts ${esc(we.windGust)} km/h</p>
            <p class="muted">Today ${esc(we.todayMin.toFixed(0))}° to ${esc(we.todayMax.toFixed(0))}°, ${esc(we.todayRain.toFixed(1))} mm rain expected</p>
            ${st ? `<p class="station">Measured at <strong>${esc(st.name)}</strong>${st.county !== id ? ` (nearest station, Co. ${esc(nameOf(st.county))})` : ''}:
                ${esc(st.temperature ?? '–')}°C, wind ${esc(st.windKmh ?? '–')} km/h, ${esc(st.rainToday)} mm rain so far today <span class="muted">at ${esc(st.time)}</span></p>
            <div class="trend-slot" data-trend="station" data-station="${esc(st.id)}" data-name="${esc(st.name)}"></div>` : ''}` : unavailable,
            st ? ['met.ie', 'https://www.met.ie/latest-reports/observations'] : null);

        // Forecast
        const fc = data.forecast?.counties?.[id];
        if (fc?.length) {
            html += section('Next few days', `<div class="forecast">${fc.map(d => `
                <div class="fday"><div class="fday-name">${esc(dayName(d.date).split(' ')[0])}</div>
                <div class="fday-temp">${esc(d.max)}°<span> / ${esc(d.min)}°</span></div>
                <div class="fday-sum">${esc(d.summary || '')}</div>
                <div class="muted">${esc(d.rain)} mm · gusts ${esc(d.gustKmh)}</div></div>`).join('')}</div>`, ['Met Éireann', 'https://www.met.ie/forecasts']);
        }

        // Sun and moon
        const middle = L.geoJSON(f).getBounds().getCenter();
        html += section('Daylight and moon', skyHtml(middle.lat, middle.lng));

        // Air quality
        const aq = data.airquality?.counties?.[id];
        if (aq) {
            html += section('Air quality', `
                <div class="row"><span class="big">${esc(aq.band)}</span><span class="soft">European index ${esc(aq.aqi)}</span></div>
                <p class="muted">PM2.5 ${esc(aq.pm25)} · PM10 ${esc(aq.pm10)} · NO₂ ${esc(aq.no2)} · ozone ${esc(aq.ozone)} µg/m³</p>
                <p class="muted">Model estimate for the middle of the county. The EPA's measured readings are on airquality.ie.</p>`,
                ['airquality.ie', 'https://airquality.ie/']);
        }

        // Hospitals
        if (data.trolleys && !ni) {
            const list = data.trolleys.hospitals.filter(x => x.county === id);
            html += section('Hospital trolleys', list.length ? `
                <ul class="list">${list.map(x => `<li>${esc(x.name)} <span class="pill ${x.total >= 15 ? 'bad' : x.total >= 5 ? 'warn' : 'down'}">${esc(x.total)} on trolleys</span>
                    <span class="meta">${esc(x.ed)} in ED, ${esc(x.ward)} on wards</span></li>`).join('')}</ul>
                <p class="muted">At 8am ${esc((data.trolleys.reported || '').replace(/^08:00\s*/, '').replace(/\s*-\s*$/, ''))}, HSE TrolleyGAR</p>`
                : '<p class="soft">No hospital in this county reports trolley numbers.</p>', ['HSE', 'https://uec.hse.ie/uec/TGAR.php']);
        }

        // Jobs and new homes
        const ec = data.economy?.counties?.[id];
        if (ec) {
            const homes = per1000(ec.newHomes, id);
            html += section('Jobs and new homes', `
                <div class="row"><span class="big">${esc(fmt(ec.liveRegister))}</span><span class="soft">on the Live Register</span>
                ${ec.liveRegisterChange != null ? `<span class="pill ${ec.liveRegisterChange > 0 ? 'up' : 'down'}">${esc(pct(ec.liveRegisterChange))} on last year</span>` : ''}</div>
                <p class="muted">${esc(monthName(data.economy.liveRegisterMonth))}. Includes part-time and casual workers, so it isn't the unemployment rate.</p>
                <div class="row" style="margin-top:8px"><span class="big">${esc(fmt(ec.newHomes))}</span><span class="soft">new homes completed</span></div>
                <p class="muted">${esc(data.economy.newHomesPeriod.replace(/(\d{4})Q(\d)/g, 'Q$2 $1'))}${homes != null ? ` · ${esc(homes.toFixed(1))} per 1,000 people` : ''}</p>`,
                ['CSO', 'https://data.cso.ie/']);
        }

        // Crime
        if (data.crime?.counties?.[id]) {
            const divs = data.crime.counties[id].map(i => data.crime.divisions[i]);
            const p = data.crime.period;
            const label = { assaults: 'Assaults', burglary: 'Burglary', theft: 'Theft', drugs: 'Drugs', damage: 'Criminal damage', publicOrder: 'Public order' };
            html += section('Recorded crime', `${divs.map(d => `
                <div class="constituency">${esc(d.name)} Garda division${d.counties.length > 1 ? ` <span class="muted">(${esc(d.counties.map(nameOf).join(', '))})</span>` : ''}</div>
                <div class="row"><span class="big">${esc(fmt(d.total))}</span><span class="soft">crimes recorded in a year</span>
                ${d.change != null ? `<span class="pill ${d.change > 0 ? 'up' : 'down'}">${esc(pct(d.change))}</span>` : ''}</div>
                <p class="muted">${Object.entries(label).filter(([k]) => d.groups[k]).map(([k, l]) => `${l} ${fmt(d.groups[k])}`).join(' · ')}</p>`).join('')}
                ${data.crime.changePeriod ? `<p class="muted">Change compares ${esc(quarterSpan(data.crime.changePeriod.from, data.crime.changePeriod.to))} with the same months a year earlier${data.crime.changePeriod.from !== p.from ? ' (the current divisions only start in 2025)' : ''}.</p>` : ''}
                <p class="muted">The CSO publishes these figures "under reservation" because of concerns about how crime is recorded.</p>
                ${asOf(`Figures for ${quarterSpan(p.from, p.to)}, published ${shortDate(data.crime.published)}`, quarterAgeDays(p.to) > 200)}`,
                ['CSO', 'https://data.cso.ie/table/CJQ10']);
        }

        // Earthquakes
        const quakes = (data.earthquakes?.quakes || []).filter(q => q.county === id);
        if (quakes.length) {
            html += section(`Earthquakes in the last year (${quakes.length})`, `<ul class="list">${quakes.slice(0, 5).map(q => `
                <li>Magnitude ${esc(q.magnitude)} <span class="meta">${esc(when(q.time))} · ${esc(q.depthKm)} km deep</span></li>`).join('')}</ul>
                <p class="muted">Small tremors recorded by the Irish National Seismic Network; most are too small to feel.</p>`, ['INSN', 'https://www.insn.ie/']);
        }

        // Water notices
        if (data.waterAll) {
            const list = data.waterAll.notices.filter(n => n.county === id).sort((a, b) => b.active - a.active || a.start.localeCompare(b.start));
            html += section(`Water notices (${list.length})`, list.length ? `<ul class="list">${list.slice(0, 8).map(n => `
                <li><strong>${esc(n.title)}</strong><br>
                <span class="pill">${esc(WATER_LABELS[n.kind] || n.kind)}</span>${n.active ? '<span class="pill warn">Now</span>' : ''}
                <span class="meta">${n.issuer === 'NI Water' ? `updated ${esc(when(n.updated))}${n.end ? `, expected back ${esc(when(n.end))}` : ''}` : `${esc(when(n.start))} to ${esc(when(n.end))}`}</span></li>`).join('')}</ul>
                ${list.length > 8 ? `<p class="muted">and ${list.length - 8} more</p>` : ''}` : '<p class="soft">No current or upcoming notices.</p>',
                ni ? ['NI Water', 'https://www.niwater.com/whats-happening-in-your-area/current-service-updates'] : ['water.ie', 'https://www.water.ie/water-service-updates']);
        } else html += section('Water notices', unavailable);

        // Rivers
        // OPW gauges are in the Republic (a few sit on the border); skip the section in NI counties without one
        if (data.rivers && !(ni && !data.rivers.stations.some(s => s.county === id))) {
            const list = data.rivers.stations.filter(s => s.county === id);
            const known = list.filter(s => s.change != null).sort((a, b) => b.change - a.change);
            const rising = known.filter(s => s.trend.startsWith('rising'));
            let body;
            if (!list.length) body = '<p class="soft">No OPW gauges in this county.</p>';
            else if (!known.length) body = '<p class="soft">Rising and falling trends appear after a few hours of readings.</p>';
            else body = `<p class="soft">${rising.length ? `<strong>${rising.length}</strong> rising` : 'None rising'} in the last 6 hours.</p>
                <ul class="list">${known.slice(0, 5).map(s => `<li>${esc(s.name)} <span class="trend ${s.change > 0 ? 'up' : 'down'}">${s.change > 0 ? '+' : ''}${(s.change * 100).toFixed(0)} cm</span>
                <span class="meta">${esc(s.level.toFixed(2))} m</span></li>`).join('')}</ul>`;
            // Charts for the two gauges that moved most (or the first two, before trends are known)
            if (list.length) {
                const chartFor = (known.length ? [...known].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)) : list).slice(0, 2);
                body += `<div class="trend-slot" data-trend="rivers" data-county="${esc(id)}" data-refs="${esc(chartFor.map(s => s.ref + '|' + s.name).join(';'))}"></div>`;
            }
            html += section(`Rivers (${list.length} gauges)`, body, ['waterlevel.ie', 'https://waterlevel.ie/']);
        }

        // Place names
        const pn = data.placenames?.counties?.[id];
        if (pn) {
            html += section('Place names', `
                <div class="row"><span class="big">${esc(fmt(pn.townlands))}</span><span class="soft">townlands</span></div>
                <p class="muted">${esc(fmt(pn.towns))} towns · ${esc(fmt(pn.parishes))} civil parishes · ${esc(fmt(pn.baronies))} baronies${pn.islands ? ` · ${esc(fmt(pn.islands))} islands` : ''}</p>
                <p class="soft">Click anywhere on the map to see its townland and Irish name.</p>`, ['logainm.ie', 'https://www.logainm.ie/']);
        }

        // Public transport right now
        if ((data.buses || data.trains) && !ni) {
            const buses = (data.buses?.buses || []).filter(b => b.county === id);
            const trains = (data.trains?.trains || []).filter(t => t.county === id);
            const routes = Object.entries(buses.reduce((acc, b) => (acc[b.route] = (acc[b.route] || 0) + 1, acc), {}))
                .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r]) => r).filter(Boolean);
            const late = buses.filter(b => b.minutesLate >= 5).length + trains.filter(t => t.minutesLate >= 5).length;
            html += section('Public transport now', buses.length || trains.length ? `
                <div class="row"><span class="big">${esc(fmt(buses.length))}</span><span class="soft">buses</span>
                <span class="big">${esc(fmt(trains.length))}</span><span class="soft">trains</span></div>
                <p class="muted">${late ? `${late} running 5+ minutes late` : 'None running notably late'}${routes.length ? ` · busiest routes: ${esc(routes.join(', '))}` : ''}</p>`
                : '<p class="soft">No tracked buses or trains here at the last update.</p>', ['TFI Live', 'https://www.transportforireland.ie/']);
        }

        // Luas (Dublin only)
        if (id === 'dublin') html += luasSection();

        // House prices
        const h = data.housing?.counties?.[id];
        if (!ni) html += section('House prices', h ? `
            <div class="row"><span class="big">${esc(euro(h.median))}</span>
            <span class="pill ${h.change > 0 ? 'up' : h.change < 0 ? 'down' : ''}">${esc(pct(h.change))} on last year</span></div>
            <p class="muted">Median of ${esc(fmt(h.sales))} sales in the last 12 months</p>` : unavailable, ['Property Price Register', 'https://www.propertypriceregister.ie/']);

        // Rent
        const rent = data.rents?.counties?.[id];
        if (rent) {
            const hist = rent.history.filter(([, v]) => v != null);
            html += section('Rent', `
                <div class="row"><span class="big">€${esc(fmt(rent.rent))}</span><span class="soft">a month on average</span>
                ${rent.change != null ? `<span class="pill ${rent.change > 0 ? 'up' : 'down'}">${esc(pct(rent.change))} on a year earlier</span>` : ''}</div>
                <p class="muted">New tenancies registered with the RTB, all property types and sizes.</p>
                ${spark([{ values: hist.map(r => r[1]), colour: '#7c3aed', label: 'Average rent' }], { labels: [quarterName(hist[0][0]), quarterName(hist[hist.length - 1][0])], unit: ' €' })}
                ${asOf(`Figures for ${quarterName(data.rents.quarter)}, published ${shortDate(data.rents.published)}`, quarterAgeDays(data.rents.quarter) > 270)}`,
                ['RTB', 'https://www.rtb.ie/data-insights/rtb-rent-index']);
        }

        // Beaches
        const bc = data.beaches?.counties?.[id];
        if (data.beaches && !ni) {
            const list = data.beaches.beaches.filter(b => b.county === id);
            html += section(`Bathing waters (${list.length})`, !list.length ? '<p class="soft">No designated bathing waters.</p>' : `
                <p class="soft">${bc.blueFlag} Blue Flag · ${bc.excellent} excellent${bc.poor ? ` · <strong>${bc.poor} poor</strong>` : ''}${bc.restricted ? ` · ${bc.restricted} with restrictions` : ''}</p>
                <ul class="list">${list.slice(0, 12).map(b => `<li>${esc(b.name)}
                    ${b.blueFlag ? '<span class="pill down">Blue Flag</span>' : ''}${b.restricted ? '<span class="pill bad">Restricted</span>' : ''}
                    <span class="meta">${esc((b.classification || 'Not classified').replace(' Quality', ''))}</span></li>`).join('')}</ul>
                ${list.length > 12 ? `<p class="muted">and ${list.length - 12} more</p>` : ''}`, ['beaches.ie', 'https://www.beaches.ie/']);
        }

        // People
        const pop = data.population?.counties?.[id];
        if (!ni) html += section('People', pop ? `
            <div class="row"><span class="big">${esc(fmt(pop.population))}</span><span class="soft">people (Census 2022)</span></div>
            <p class="muted">${esc(fmt(pop.density))} per km² · ${esc(fmt(pop.areaKm2))} km²</p>
            ${censusHtml(id)}` : unavailable, ['CSO', 'https://data.cso.ie/table/FY003A']);

        // TDs
        if (ni) {
            html += section('Representatives', `<p class="soft">Northern Ireland elects MPs to Westminster and MLAs to the Northern Ireland Assembly, not TDs.</p>`,
                ['niassembly.gov.uk', 'https://www.niassembly.gov.uk/']);
        } else if (data.tds) {
            const list = data.tds.tds.filter(t => t.counties.includes(id));
            const byConstituency = list.reduce((acc, t) => ((acc[t.constituency] = acc[t.constituency] || []).push(t), acc), {});
            html += section(`TDs (${list.length})`, Object.entries(byConstituency).map(([con, members]) => `
                <div class="constituency">${esc(con)}</div>
                <ul class="list">${members.map(t => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>
                    <span class="party">${esc(t.party)}</span>${t.offices.length ? `<br><span class="meta">${esc(t.offices[0])}</span>` : ''}</li>`).join('')}</ul>`).join('') || unavailable,
                ['oireachtas.ie', 'https://www.oireachtas.ie/en/members/']);
        }
        return html;
    }

    function nationalPanel() {
        const w = data.warnings?.warnings || [];
        const ranked = (key, label, format, desc = true) => {
            const rows = counties.map(f => [f.properties.id, key(f.properties.id)]).filter(([, v]) => v != null)
                .sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1]).slice(0, 5);
            return section(label, `<ul class="list">${rows.map(([id, v]) => `<li><a href="#" data-county="${id}">${esc(nameOf(id))}</a> <span class="meta">${esc(format(v))}</span></li>`).join('')}</ul>`);
        };
        return `<h2>All of Ireland</h2>
            <p class="panel-intro">Click any county for its warnings, weather and forecast, air quality, hospital trolleys, water notices, rivers, beaches, jobs, new homes, house prices, population and TDs. Use the buttons above the map to colour the counties or show live points.</p>
            ${section('Weather warnings', w.length ? w.map(x => `<div class="warning ${esc(x.level)}"><strong>${esc(x.headline)}</strong>
                <span class="muted">until ${esc(when(x.expiry))}</span></div>`).join('') : '<p class="soft">No warnings in force.</p>', ['met.ie', 'https://www.met.ie/warnings'])}
            ${data.waterAll ? ranked(id => { const c = data.waterAll.counties[id]; return c ? c.active + c.upcoming : null; }, 'Most water notices', v => `${v} notices`) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.median, 'Highest house prices', euro) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.change, 'Fastest-rising prices', pct) : ''}
            ${data.rents ? ranked(id => data.rents.counties[id]?.rent, 'Highest rents', v => `€${fmt(v)} a month`) + asOf(`RTB figures for ${quarterName(data.rents.quarter)}`, quarterAgeDays(data.rents.quarter) > 270) : ''}
            ${data.weather ? ranked(id => data.weather.counties[id]?.temperature, 'Warmest right now', v => `${v.toFixed(1)}°C`) : ''}
            ${luasSection()}
            ${electricitySection()}
            ${trolleySection()}
            ${fuelSection()}
            ${dailSection()}
            ${spaceSection()}
            ${quakeSection()}`;
    }

    // EirGrid times look like "31-Oct-2026 21:00:00"
    const gridHour = t => String(t || '').slice(12, 17);

    function electricitySection() {
        const g = data.grid?.national;
        if (!g?.day?.length) return '';
        const first = g.day[0][0];
        const last = g.day[g.day.length - 1][0];
        return section('Electricity, last 24 hours', `
            <p class="soft">Demand now <strong>${esc(fmt(g.demandMW))} MW</strong>, wind supplying <strong>${esc(g.windPercent)}%</strong>.
            ${g.peakMW ? `Peak ${esc(fmt(g.peakMW))} MW at ${esc(gridHour(g.peakTime))}.` : ''}</p>
            ${spark([
                { values: g.day.map(r => r[1]), colour: '#3d7ea6', label: 'Demand' },
                { values: g.day.map(r => r[2]), colour: '#1f8a5b', label: 'Wind' }
            ], { labels: [gridHour(first), gridHour(last)], unit: ' MW', min: 0 })}
            <p class="muted">All-island, megawatts. Carbon intensity ${esc(fmt(g.co2))} gCO₂/kWh.</p>`,
            ['Smart Grid Dashboard', 'https://www.smartgriddashboard.com/']);
    }

    // Luas line status (no tram times: the site updates hourly, so they would be stale)
    function luasSection() {
        const l = data.luas;
        if (!l?.lines) return '';
        const rows = Object.entries(l.lines).map(([key, line]) => `
            <p class="soft"><strong>${esc(line.name)}</strong> <span class="pill ${line.normal ? 'down' : 'warn'}">${esc(line.normal ? 'Normal' : 'Disrupted')}</span><br>${esc(line.message)}</p>`).join('');
        return section('Luas', rows + (l.sourceTime ? asOf(`Status at ${clock(l.sourceTime)}`, hoursOld(l.sourceTime) > 2) : ''),
            ['luas.ie', 'https://luas.ie/']);
    }

    function trolleySection() {
        const t = data.trolleys;
        if (!t) return '';
        return section('Most patients on trolleys', `
            <p class="soft"><strong>${esc(fmt(t.national.total))}</strong> people waiting on trolleys at 8am
            ${t.national.ed != null ? `(${esc(t.national.ed)} in emergency departments, ${esc(t.national.ward)} on wards)` : ''}</p>
            <ul class="list">${t.hospitals.slice(0, 5).map(x => `<li>${x.county ? `<a href="#" data-county="${esc(x.county)}">${esc(x.name)}</a>` : esc(x.name)}
                <span class="meta">${esc(x.total)}</span></li>`).join('')}</ul>
            <p class="muted">${esc((t.reported || '').replace(/\s*-\s*$/, ''))} report. The HSE publishes on weekdays.</p>`,
            ['HSE TrolleyGAR', 'https://uec.hse.ie/uec/TGAR.php']);
    }

    function fuelSection() {
        const f = data.fuel?.national;
        if (!f) return '';
        const diff = (now, then) => then ? `${now >= then ? '+' : '−'}${Math.abs(Math.round((now - then) * 100))}c` : '';
        return section('Fuel prices', `
            <ul class="list">
                <li>Petrol <strong>${esc(euroL(f.petrol))}</strong> <span class="meta">${esc(diff(f.petrol, f.yearAgo?.petrol))} on a year ago</span></li>
                <li>Diesel <strong>${esc(euroL(f.diesel))}</strong> <span class="meta">${esc(diff(f.diesel, f.yearAgo?.diesel))} on a year ago</span></li>
                ${f.heatingOil ? `<li>Home heating oil <strong>${esc(euroL(f.heatingOil))}</strong> <span class="meta">${esc(diff(f.heatingOil, f.yearAgo?.heatingOil))} on a year ago</span></li>` : ''}
            </ul>
            ${spark([
                { values: f.history.map(r => r[1]), colour: '#c2410c', label: 'Petrol' },
                { values: f.history.map(r => r[2]), colour: '#334155', label: 'Diesel' }
            ], { labels: [dayName(f.history[0][0]), dayName(f.history[f.history.length - 1][0])], unit: ' €/l' })}
            <p class="muted">National average per litre, week of ${esc(dayName(f.date))}. Prices vary from station to station.</p>`,
            ['EU Oil Bulletin', 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en']);
    }

    function dailSection() {
        const d = data.dail;
        if (!d) return '';
        const today = new Date().toISOString().slice(0, 10);
        return section('In the Dáil', `
            ${d.lastSitting ? `<p class="soft">Last sitting day, <a href="${esc(d.lastSitting.url)}" target="_blank" rel="noopener">${esc(dayName(d.lastSitting.date))}</a>:
                ${esc(d.lastSitting.topics.slice(0, 8).join(', '))}</p>` : ''}
            <ul class="list">${d.bills.slice(0, 6).map(b => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a><br>
                <span class="meta">${esc(b.stage || b.status)}${b.stageDate ? ` · ${b.stageDate > today ? 'scheduled for ' : ''}${esc(dayName(b.stageDate))}` : ''}${b.sponsor ? ` · ${esc(b.sponsor)}` : ''}</span></li>`).join('')}</ul>`,
            ['oireachtas.ie', 'https://www.oireachtas.ie/en/bills/']);
    }

    // What each Kp level means for seeing the aurora from Ireland (about 51.5–55.4°N)
    const KP_GUIDE = [
        { min: 0, max: 2, colour: '#94a3b8', name: 'Quiet', text: 'No chance from Ireland' },
        { min: 3, max: 4, colour: '#cbd5e1', name: 'Unsettled', text: 'Very unlikely. Kp 4 can show a faint glow on camera from the far north coast' },
        { min: 5, max: 5, colour: '#facc15', name: 'Minor storm (G1)', text: 'Possible on camera from northern coasts: Malin Head, north Mayo, Sligo' },
        { min: 6, max: 6, colour: '#fb923c', name: 'Moderate storm (G2)', text: 'Often visible by eye in the north, on camera across the northern half' },
        { min: 7, max: 7, colour: '#ef4444', name: 'Strong storm (G3)', text: 'Good chance across Ireland, by eye in the north and midlands' },
        { min: 8, max: 9, colour: '#a21caf', name: 'Severe storm (G4–G5)', text: 'Visible everywhere, even in the south and in towns (May and October 2024 reached these)' }
    ];
    // Round down, as NOAA does: Kp 4.67 ("5-") isn't yet a G1 storm
    const kpLevel = kp => KP_GUIDE.find(g => Math.floor(kp) <= g.max) || KP_GUIDE[KP_GUIDE.length - 1];

    /**
     * An ⓘ that opens a help box on hover, keyboard focus or tap.
     * intro and note are plain text; rows (optional) is a good-to-bad scale:
     * [{ range, colour, name, text, now, next }], drawn like the Kp guide.
     */
    function help(title, { intro = '', rows = [], note = '' } = {}) {
        return `<span class="help" tabindex="0" role="button" aria-label="${esc(title)}">ⓘ
            <span class="help-box" role="tooltip">
                <span class="kp-title">${esc(title)}</span>
                ${intro ? `<span class="help-intro">${esc(intro)}</span>` : ''}
                ${rows.length ? `<span class="kp-guide">${rows.map(r => `
                    <span class="kp-row${r.now ? ' kp-now' : ''}">
                        <span class="kp-num" style="background:${r.colour}">${esc(r.range)}</span>
                        <span><strong>${esc(r.name)}</strong>${r.now ? ' <span class="pill warn">Now</span>' : ''}${r.next ? ' <span class="pill">Next 24 hrs</span>' : ''}
                        ${r.text ? `<span class="meta">${esc(r.text)}</span>` : ''}</span>
                    </span>`).join('')}</span>` : ''}
                ${note ? `<span class="help-note">${esc(note)}</span>` : ''}
            </span></span>`;
    }

    /** Mark the scale row a value falls in: rows have [min, max) bounds in `from`/`to`. */
    const placeOn = (rows, value) => rows.map(r => ({ ...r, now: value != null && value >= r.from && value < r.to }));

    function kpHelp() {
        const s = data.space?.national;
        const nowLevel = s?.kp != null ? kpLevel(s.kp) : null;
        const peakLevel = s?.peakKp != null ? kpLevel(s.peakKp) : null;
        return help('What Kp numbers mean in Ireland', {
            rows: KP_GUIDE.map(g => ({
                range: g.min === g.max ? String(g.min) : `${g.min}–${g.max}`, colour: g.colour, name: g.name, text: g.text,
                now: g === nowLevel, next: g === peakLevel && g !== nowLevel
            })),
            note: "Kp runs from 0 to 9 and measures how disturbed Earth's magnetic field is; the higher it is, the further south the aurora reaches. "
                + "Ireland usually needs Kp 5 or more, plus a clear sky, a dark spot and a view of the northern horizon. Phone cameras pick up colour the eye can't."
        });
    }

    /** Help for each summary card, keyed by the card's label. */
    function cardHelp(label) {
        const g = data.grid?.national;
        const econ = data.economy?.national;
        const tr = data.trolleys?.national;
        const worstAqi = data.airquality ? Math.max(...Object.values(data.airquality.counties).map(c => c.aqi ?? 0)) : null;
        const top = ['red', 'orange', 'yellow'].find(l => (data.warnings?.warnings || []).some(x => x.level === l)) || 'none';
        const GREEN = '#86efac', LIME = '#d9f99d', YELLOW = '#fde047', ORANGE = '#fdba74', RED = '#fca5a5', DARK = '#f87171', GREY = '#cbd5e1';

        switch (label) {
            case 'Weather warnings':
                return help('Met Éireann weather warnings', {
                    intro: 'Warnings in force now anywhere on the island: Met Éireann for the Republic, the Met Office for Northern Ireland (its amber is shown as orange). Click a county to see its own.',
                    rows: [
                        { range: '–', colour: '#9fd3bd', name: 'None', text: 'No warnings in force', now: top === 'none' },
                        { range: 'Y', colour: '#f2c418', name: 'Yellow', text: 'Be aware: weather that could cause local problems', now: top === 'yellow' },
                        { range: 'O', colour: '#ef8a1f', name: 'Orange', text: 'Be prepared: significant disruption is likely', now: top === 'orange' },
                        { range: 'R', colour: '#d7263d', name: 'Red', text: 'Take action: rare, dangerous weather. Follow official advice', now: top === 'red' }
                    ]
                });
            case 'Wind power':
                return help('Wind power', {
                    intro: 'The share of electricity demand being met by wind right now, across the whole island (Ireland and Northern Ireland). Higher is better: less gas burned, lower emissions.',
                    rows: placeOn([
                        { from: 0, to: 15, range: '<15%', colour: GREY, name: 'Calm', text: 'Gas plants are doing most of the work' },
                        { from: 15, to: 40, range: '15–40%', colour: LIME, name: 'Typical' },
                        { from: 40, to: 60, range: '40–60%', colour: GREEN, name: 'Windy' },
                        { from: 60, to: 101, range: '60%+', colour: '#4ade80', name: 'Very high', text: 'Close to the grid’s limit of about 75% wind and solar at any moment' }
                    ], g?.windPercent),
                    note: 'Carbon intensity is grams of CO₂ per kWh of electricity: roughly under 150 is low, over 350 is high.'
                });
            case 'Trains running':
                return help('Trains running', {
                    intro: 'Irish Rail trains moving right now, from Irish Rail’s live map. The number depends on the time of day: most at rush hour, few or none late at night.',
                    note: '“Late” means 5 or more minutes behind the timetable, as Irish Rail reports it. Fewer late is better.'
                });
            case 'Buses tracked':
                return help('Buses tracked', {
                    intro: 'Republic of Ireland only. TFI buses sending their GPS position to the National Transport Authority right now: Dublin Bus, Bus Éireann, Go-Ahead and others. Like trains, the number follows the time of day.',
                    note: '“Late” means 5 or more minutes behind the timetable at the next stop. Buses with no delay information aren’t counted as late.'
                });
            case 'Water notices':
                return help('Water notices', {
                    intro: 'Uisce Éireann notices in the Republic and NI Water incidents in Northern Ireland, in force now: boil water and do-not-drink notices, supply interruptions, low pressure and works. “More due” are planned ones starting in the next 7 days.',
                    note: 'Boil water and do-not-drink notices are the serious ones. Turn on “Water notices” above the map to see where they are.'
                });
            case 'Rivers rising':
                return help('Rivers rising', {
                    intro: 'OPW river and lake gauges whose level has gone up over the last 6 hours. Fewer is better: many rising together usually follows heavy rain.',
                    rows: [
                        { range: '+10cm', colour: '#ef8a1f', name: 'Rising', text: '10 to 30 cm higher than 6 hours ago' },
                        { range: '+30cm', colour: '#d7263d', name: 'Rising fast', text: '30 cm or more higher than 6 hours ago' }
                    ],
                    note: 'A rising river isn’t necessarily flooding. Check floodinfo.ie and your council for flood warnings.'
                });
            case 'House prices':
                return help('House prices', {
                    intro: 'Republic of Ireland only. The middle (median) price of homes sold at full market price in the last 12 months, from the Property Price Register, and how it compares with the 12 months before.',
                    note: 'The register only shows a sale once it’s been filed, usually weeks after the sale closes, so the newest months are incomplete. Prices of new homes are shown without VAT.'
                });
            case 'On trolleys':
                return help('Patients on trolleys', {
                    intro: 'Republic of Ireland only. People admitted to hospital who are waiting for a bed, counted at 8am by the HSE: on trolleys in emergency departments or on extra trolleys on wards. Lower is better.',
                    rows: [
                        { range: '0–4', colour: GREEN, name: 'Low', text: 'For one hospital' },
                        { range: '5–14', colour: YELLOW, name: 'Busy' },
                        { range: '15+', colour: DARK, name: 'Overcrowded' }
                    ],
                    note: `${tr ? `Today’s ${tr.total} across all hospitals. ` : ''}The nurses’ union (INMO) publishes its own count, which is usually higher because it counts differently. The HSE reports on weekdays only.`
                });
            case 'Petrol · diesel':
                return help('Fuel prices', {
                    intro: 'Republic of Ireland only. The national average pump price per litre, including VAT, excise and carbon tax, as the Government reports it each Monday to the EU’s Weekly Oil Bulletin.',
                    note: 'Prices vary from station to station, often by 10c or more. The panel on the right compares them with a year ago and shows home heating oil.'
                });
            case 'Unemployment':
                return help('Unemployment rate', {
                    intro: 'Republic of Ireland only. The share of people aged 15–74 who want work and are actively looking but don’t have a job (the international ILO definition), from the CSO each month, seasonally adjusted. Lower is better.',
                    rows: placeOn([
                        { from: 0, to: 5, range: '<5%', colour: GREEN, name: 'Very low', text: 'Close to full employment' },
                        { from: 5, to: 8, range: '5–8%', colour: YELLOW, name: 'Moderate' },
                        { from: 8, to: 12, range: '8–12%', colour: ORANGE, name: 'High' },
                        { from: 12, to: 100, range: '12%+', colour: DARK, name: 'Very high', text: 'It peaked around 16% in 2012' }
                    ], econ?.unemployment.rate),
                    note: 'This isn’t the Live Register shown for each county, which also counts part-time and casual workers.'
                });
            case 'Inflation':
                return help('Inflation', {
                    intro: 'Republic of Ireland only. How much prices have risen in a year, measured by the CSO’s Consumer Price Index each month.',
                    rows: placeOn([
                        { from: -100, to: 0, range: '<0%', colour: GREY, name: 'Falling prices', text: 'Deflation, usually a sign of a weak economy' },
                        { from: 0, to: 2.5, range: '0–2.5%', colour: GREEN, name: 'On target', text: 'The European Central Bank aims for 2%' },
                        { from: 2.5, to: 5, range: '2.5–5%', colour: YELLOW, name: 'Above target' },
                        { from: 5, to: 100, range: '5%+', colour: DARK, name: 'High', text: 'It peaked at over 9% in 2022' }
                    ], econ?.inflation.annual)
                });
            case 'Air quality':
                return help('Air quality', {
                    intro: 'The European Air Quality Index for the worst of all 32 counties right now, from the Copernicus air quality model. It combines fine particles (PM2.5, PM10), nitrogen dioxide and ozone. Lower is better.',
                    rows: placeOn([
                        { from: 0, to: 20.5, range: '0–20', colour: '#50c1a8', name: 'Good' },
                        { from: 20.5, to: 40.5, range: '20–40', colour: LIME, name: 'Fair' },
                        { from: 40.5, to: 60.5, range: '40–60', colour: YELLOW, name: 'Moderate', text: 'Sensitive people may want to cut down on hard exercise outdoors' },
                        { from: 60.5, to: 80.5, range: '60–80', colour: ORANGE, name: 'Poor' },
                        { from: 80.5, to: 100.5, range: '80–100', colour: RED, name: 'Very poor' },
                        { from: 100.5, to: 1e9, range: '100+', colour: '#a21caf', name: 'Extremely poor' }
                    ], worstAqi),
                    note: 'In Ireland it’s worst on cold, still evenings when smoke from solid fuel builds up in towns. These are model estimates; the EPA’s measured readings are on airquality.ie.'
                });
            case 'Northern Lights':
                return kpHelp();
            default:
                return '';
        }
    }

    // Help boxes are position: fixed so scrolling panels can't clip them; place each beside its ⓘ,
    // kept inside the window (phones pin them across the screen in CSS instead)
    function placeHelp(e) {
        const help = e.target.closest?.('.help');
        if (!help || window.innerWidth <= 560) return;
        const box = help.querySelector('.help-box');
        const icon = help.getBoundingClientRect();
        box.style.visibility = 'hidden';
        box.style.display = 'block';
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        box.style.display = '';
        box.style.visibility = '';
        const left = Math.min(Math.max(8, icon.right - w), window.innerWidth - w - 8);
        const below = icon.bottom + 6;
        const top = below + h > window.innerHeight - 8 ? Math.max(8, icon.top - h - 6) : below;
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
    }
    document.addEventListener('mouseover', placeHelp);
    document.addEventListener('focusin', placeHelp);

    /** Darkness and moonlight tonight, for the middle of Ireland. */
    function tonightHtml() {
        const now = new Date();
        const t = astro.sunTimes(now, 53.4, -7.9);
        const m = astro.moon(now);
        const dark = hhmm(t.night);
        return `<p class="soft">Tonight: ${dark ? `fully dark from ${esc(dark)} to ${esc(hhmm(t.nightEnd) || '–')}` : 'the sky never gets fully dark at this time of year'}.
            ${esc(m.name)}, ${esc(Math.round(m.fraction * 100))}% lit${m.fraction > 0.6 ? ', which will wash out fainter displays' : m.fraction < 0.25 ? ', so skies are dark' : ''}.</p>`;
    }

    function spaceSection() {
        const s = data.space?.national;
        if (!s) return '';
        return section('Northern Lights', `
            <p class="soft"><strong>${esc(s.aurora.text)}.</strong> The Kp index is ${esc(s.kp ?? '–')} now${s.peakKp != null ? ` and forecast to reach ${esc(s.peakKp)} in the next 24 hours` : ''}. ${kpHelp()}</p>
            ${spark([{ values: s.history.map(r => r[1]), colour: '#7c3aed', label: 'Kp, last 3 days' }], { labels: ['3 days ago', 'now'], min: 0 })}
            ${tonightHtml()}
            ${asOf(`Kp reading ${clock(s.kpTime)}`, hoursOld(s.kpTime) > 6)}`,
            ['NOAA SWPC', 'https://www.swpc.noaa.gov/products/planetary-k-index']);
    }

    function quakeSection() {
        const q = data.earthquakes?.quakes;
        if (!q) return '';
        const biggest = q.reduce((best, x) => (x.magnitude ?? -9) > (best?.magnitude ?? -9) ? x : best, null);
        return section('Earthquakes in the last year', q.length ? `
            <p class="soft"><strong>${esc(q.length)}</strong> recorded in and around Ireland${biggest ? `, the largest magnitude ${esc(biggest.magnitude)} (${esc(biggest.region.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()))})` : ''}.</p>
            <ul class="list">${q.slice(0, 4).map(x => `<li>Magnitude ${esc(x.magnitude)} ${x.county ? `near <a href="#" data-county="${esc(x.county)}">${esc(nameOf(x.county))}</a>` : `<span class="meta">${esc(x.region)}</span>`}
                <span class="meta">${esc(when(x.time))}</span></li>`).join('')}</ul>
            <p class="muted">Turn on Earthquakes above the map to see them all.</p>` : '<p class="soft">None recorded in the last year.</p>',
            ['EMSC', 'https://www.seismicportal.eu/']);
    }

    function renderPanel() {
        const panel = document.getElementById('panel');
        panel.innerHTML = selected ? countyPanel(selected) : nationalPanel();
        if (selected) fillTrends();
        panel.scrollTop = 0;
    }

    /**
     * opts.zoom: fit the map to the county (picked from the panel, a ranking or a shared link).
     * opts.from 'map' or 'search': on phones, show a "View X" button over the map instead of scrolling away.
     */
    function selectCounty(id, opts = {}) {
        selected = id;
        renderPanel();
        restyle();
        updateHash();
        if (id && opts.zoom) zoomToCounty(id);
        const narrow = window.matchMedia('(max-width: 860px)').matches;
        viewBtn.classList.remove('show');
        if (id && narrow) {
            if (opts.from === 'map' || opts.from === 'search') {
                viewBtn.textContent = `View ${nameOf(id)} ↓`;
                viewBtn.classList.add('show');
            } else if (opts.from === 'panel') {
                document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    // ---------- Header and footer ----------

    function renderMeta() {
        const stale = Object.entries(status?.layers || {}).filter(([, s]) => !s.ok);
        document.getElementById('updated').innerHTML = status
            ? `Updated ${esc(ago(status.builtAt))}<br><span class="muted">${esc(when(status.builtAt))}</span>`
                + (stale.length ? `<br><span class="stale">Showing older data for: ${esc(stale.map(([n]) => n).join(', '))}</span>` : '')
            : 'Update time unknown';

        const sources = LAYERS.map(n => data[n]?.source).filter(Boolean);
        sources.push({ name: 'Tailte Éireann county boundaries', url: 'https://data-osi.opendata.arcgis.com/', licence: 'CC BY 4.0' });
        sources.push({ name: 'OSNI county boundaries (Northern Ireland)', url: 'https://www.spatialni.gov.uk/', licence: 'Open Government Licence' });
        document.getElementById('footer').innerHTML = `<strong>Data sources</strong> · refreshed every hour, slower datasets daily
            <ul>${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.licence)})</li>`).join('')}</ul>
            <p style="margin-top:8px">Ireland Now is an independent project and isn't affiliated with any of these organisations.</p>`;
    }

    // ---------- Start ----------

    async function load(name) {
        try {
            const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
            if (res.ok) data[name] = await res.json();
        } catch { /* layer stays missing; panels show "not available" */ }
    }

    // ---------- Place names (Logainm): townland on click, and search ----------

    const CATEGORY_LABELS = { BF: 'Townland', B: 'Town', SRB: 'Suburb', PAR: 'Civil parish', BAR: 'Barony', OIL: 'Island' };
    const placeFiles = {};
    let placeMarker = null;

    async function placesFor(countyId) {
        if (!placeFiles[countyId]) {
            placeFiles[countyId] = fetch(`data/places/${countyId}.json`).then(r => r.ok ? r.json() : []).catch(() => []);
        }
        return placeFiles[countyId];
    }

    const logainmLink = id => `https://www.logainm.ie/${encodeURIComponent(id)}.aspx`;

    // Townland points are their centres, so the nearest one is (almost always) the townland you clicked in
    async function showTownland(latlng, countyId) {
        if (!data.placenames) return;
        const places = await placesFor(countyId);
        const kx = Math.cos(latlng.lat * Math.PI / 180);
        let best = null;
        let bestD = Infinity;
        for (const p of places) {
            if (p[1] !== 'BF') continue;
            const d = ((p[5] - latlng.lng) * kx) ** 2 + (p[4] - latlng.lat) ** 2;
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) return;
        const [id, , en, ga, , , parishEn, parishGa] = best;
        L.popup({ ...POPUP, autoPan: window.matchMedia('(max-width: 560px)').matches })
            .setLatLng(latlng)
            .setContent(`<span class="popup-meta">Townland</span><br><strong>${esc(en)}</strong>${ga ? ` · <em>${esc(ga)}</em>` : ''}
                ${parishEn ? `<br><span class="popup-meta">Civil parish of ${esc(parishEn)}${parishGa ? ` (${esc(parishGa)})` : ''}, Co. ${esc(nameOf(countyId))}</span>` : ''}
                <br><a href="${logainmLink(id)}" target="_blank" rel="noopener">History and pronunciation on logainm.ie</a>`)
            .openOn(map);
    }

    const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    function searchPlaces(query) {
        const q = fold(query.trim());
        if (q.length < 2 || !data.placenames?.search) return [];
        const starts = [];
        const contains = [];
        for (const row of data.placenames.search) {
            const en = fold(row[2]);
            const ga = fold(row[3]);
            if (en.startsWith(q) || ga.startsWith(q)) starts.push(row);
            else if (en.includes(q) || ga.includes(q)) contains.push(row);
            if (starts.length >= 12) break;
        }
        // Towns first, then the rest
        const rank = r => ['B', 'SRB', 'OIL', 'PAR', 'BAR'].indexOf(r[1]);
        return [...starts.sort((a, b) => rank(a) - rank(b)), ...contains].slice(0, 12);
    }

    let searchMatches = [];
    const searchBox = document.getElementById('search');
    const resultsBox = document.getElementById('search-results');

    function renderResults() {
        resultsBox.hidden = !searchMatches.length;
        resultsBox.innerHTML = searchMatches.map((r, i) => `
            <li role="option" data-result="${i}"><strong>${esc(r[2])}</strong>${r[3] ? ` <em>${esc(r[3])}</em>` : ''}
            <span>${esc(CATEGORY_LABELS[r[1]] || '')} · Co. ${esc(nameOf(r[6]))}</span></li>`).join('');
    }

    function goToPlace(r) {
        const [id, cat, en, ga, lat, lon, county] = r;
        searchMatches = [];
        renderResults();
        searchBox.value = en;
        map.setView([lat, lon], { B: 13, SRB: 14, OIL: 12, PAR: 12, BAR: 11 }[cat] || 12);
        placeMarker?.remove();
        placeMarker = L.marker([lat, lon]).addTo(map)
            .bindPopup(`<span class="popup-meta">${esc(CATEGORY_LABELS[cat] || '')}</span><br><strong>${esc(en)}</strong>${ga ? ` · <em>${esc(ga)}</em>` : ''}
                <br><a href="${logainmLink(id)}" target="_blank" rel="noopener">History and pronunciation on logainm.ie</a>`)
            .openPopup();
        if (county) selectCounty(county, { from: 'search' });
    }

    searchBox.addEventListener('input', () => { searchMatches = searchPlaces(searchBox.value); renderResults(); });
    searchBox.addEventListener('keydown', e => {
        if (e.key === 'Enter' && searchMatches[0]) { e.preventDefault(); goToPlace(searchMatches[0]); }
        if (e.key === 'Escape') { searchMatches = []; renderResults(); }
    });
    resultsBox.addEventListener('click', e => {
        const li = e.target.closest('[data-result]');
        if (li) goToPlace(searchMatches[Number(li.dataset.result)]);
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) { searchMatches = []; renderResults(); } });

    async function start() {
        const initialCounty = readHash();
        const [countyRes, statusRes] = await Promise.all([
            fetch('data/counties.geojson'),
            fetch('data/status.json', { cache: 'no-cache' }).catch(() => null),
            ...LAYERS.map(load)
        ]);
        counties = (await countyRes.json()).features;
        combineWater();
        status = statusRes?.ok ? await statusRes.json() : null;

        // A shared link to a county opens zoomed to it
        const startCounty = counties.some(f => f.properties.id === initialCounty) ? initialCounty : null;
        firstFocus = startCounty;

        renderControls();
        renderLegend();
        drawCounties();
        drawOverlays();
        renderNational();
        renderMeta();
        selectCounty(startCounty);
    }

    // ---------- Keep an open page up to date ----------

    const REFRESH_MINUTES = 10;

    async function refresh() {
        try {
            const res = await fetch('data/status.json', { cache: 'no-cache' });
            if (!res.ok) return;
            const next = await res.json();
            if (status && next.builtAt === status.builtAt) { renderMeta(); return; }   // nothing new; just update "x min ago"
            await Promise.all(LAYERS.map(load));
            combineWater();
            status = next;
            for (const k of Object.keys(trendFiles)) delete trendFiles[k];
            const panel = document.getElementById('panel');
            const scroll = panel.scrollTop;
            drawOverlays();
            restyle();
            renderLegend();
            renderNational();
            renderMeta();
            renderPanel();
            panel.scrollTop = scroll;   // keep the reader's place
        } catch { /* offline for a moment: try again next time */ }
    }
    setInterval(refresh, REFRESH_MINUTES * 60000);
    // Browsers slow timers in background tabs, so check as soon as the tab is looked at again
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    // Following a link to another county or view on the same page
    window.addEventListener('hashchange', () => {
        if (!counties) return;
        const county = readHash();
        for (const [key, on] of Object.entries(overlays)) {
            if (on && !map.hasLayer(overlayLayers[key])) overlayLayers[key].addTo(map);
            if (!on && map.hasLayer(overlayLayers[key])) overlayLayers[key].remove();
        }
        renderControls();
        renderLegend();
        restyle();
        const next = counties.some(f => f.properties.id === county) ? county : null;
        if (next !== selected) selectCounty(next, { zoom: Boolean(next) });
    });

    start().catch(error => {
        console.error(error);
        document.getElementById('panel').innerHTML = `<p class="empty">Couldn't load the data: ${esc(error.message)}</p>`;
    });
})();
