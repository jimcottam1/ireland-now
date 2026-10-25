// Ireland Now: front end. Loads the hourly data files and draws the map, overlays and county panel.
(function () {
    'use strict';

    const LAYERS = ['warnings', 'weather', 'rivers', 'tides', 'trains', 'buses', 'grid', 'water', 'beaches', 'tds', 'housing', 'population', 'placenames'];
    const data = {};
    let status = null;
    let counties = null;   // GeoJSON features
    let countyLayer = null;
    let selected = null;   // county id
    let view = 'warnings';
    const overlays = { water: true, rivers: false, tides: false, trains: false, buses: false };
    const overlayLayers = {};

    // ---------- Helpers ----------

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => n == null ? '–' : Number(n).toLocaleString('en-IE');
    const euro = n => n == null ? '–' : '€' + Math.round(n / 1000).toLocaleString('en-IE') + 'k';
    const pct = n => n == null ? '–' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    const nameOf = id => counties?.find(f => f.properties.id === id)?.properties.name || id;

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
            label: 'Warnings',
            value: id => data.warnings?.counties?.[id]?.level || null,
            colour: v => WARNING_COLOURS[v] || '#9fd3bd',
            describe: v => v ? `${v[0].toUpperCase() + v.slice(1)} warning` : 'No warnings',
            legend: () => `<div class="legend-title">Met Éireann warnings</div>`
                + [['#9fd3bd', 'None'], [WARNING_COLOURS.yellow, 'Yellow'], [WARNING_COLOURS.orange, 'Orange'], [WARNING_COLOURS.red, 'Red']]
                    .map(([c, l]) => `<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${l}</div>`).join('')
        },
        temperature: {
            label: 'Temperature',
            stops: [[-2, '2c5fd6'], [6, '7fb8e8'], [12, 'f4e3a1'], [18, 'f39a4a'], [26, 'c9302c']],
            value: id => data.weather?.counties?.[id]?.temperature,
            describe: v => v == null ? 'No data' : `${v.toFixed(1)}°C now`,
            ends: ['-2°C', '26°C'], title: 'Temperature now'
        },
        rain: {
            label: 'Rain today',
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
        waterView: {
            label: 'Water notices',
            stops: [[0, 'eef4f8'], [1, 'bcd9ee'], [4, '5b9bd5'], [10, '1d4e89']],
            value: id => {
                const c = data.water?.counties?.[id];
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

    function renderLegend() {
        const v = VIEWS[view];
        const el = document.getElementById('legend');
        if (v.legend) { el.innerHTML = v.legend(); return; }
        const gradient = v.stops.map(([, c], i) => `#${c} ${Math.round(100 * i / (v.stops.length - 1))}%`).join(', ');
        el.innerHTML = `<div class="legend-title">${esc(v.title)}</div>
            <div class="legend-ramp" style="background:linear-gradient(90deg, ${gradient})"></div>
            <div class="legend-ends"><span>${esc(v.ends[0])}</span><span>${esc(v.ends[1])}</span></div>`;
    }

    // ---------- Map ----------

    // minZoom 5 so the whole island fits on a phone
    // Canvas rendering copes far better than SVG with ~700 bus markers
    const map = L.map('map', { preferCanvas: true, zoomSnap: 0.25, minZoom: 5, maxZoom: 14, zoomControl: true }).setView([53.4, -8.0], 7);
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
        Object.values(overlayLayers).forEach(l => l.bringToFront?.());
    }

    function drawCounties() {
        countyLayer = L.geoJSON({ type: 'FeatureCollection', features: counties }, {
            style: styleCounty,
            onEachFeature: (feature, layer) => {
                const id = feature.properties.id;
                layer.bindTooltip(() => `${esc(feature.properties.name)}<br><span class="popup-meta">${esc(VIEWS[view].describe(VIEWS[view].value(id)))}</span>`,
                    { sticky: true, className: 'county-tip', direction: 'top', offset: [0, -6] });
                layer.on({
                    mouseover: e => e.target.setStyle({ weight: 2.5, color: '#14211c' }),
                    mouseout: () => restyle(),
                    click: e => { selectCounty(id); showTownland(e.latlng, id); }
                });
            }
        }).addTo(map);
        fitIreland();
    }

    // The controls above the map wrap differently by screen width, so measure the map after layout
    function fitIreland() {
        requestAnimationFrame(() => {
            map.invalidateSize();
            map.fitBounds(countyLayer.getBounds(), { padding: [10, 10] });
        });
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => map.invalidateSize(), 200);
    });

    // ---------- Overlays ----------

    const TREND_COLOURS = { 'rising-fast': '#d7263d', rising: '#ef8a1f', steady: '#3d7ea6', falling: '#1f8a5b', unknown: '#7c8b85' };
    const WATER_COLOURS = { 'do-not-drink': '#a4132a', 'boil-water': '#d7263d', restrictions: '#ef8a1f', outage: '#2f6fd6', 'low-pressure': '#5b9bd5', discolouration: '#8d6cc9', works: '#7c8b85' };
    const WATER_LABELS = { 'do-not-drink': 'Do not drink', 'boil-water': 'Boil water', restrictions: 'Restrictions', outage: 'Supply interruption', 'low-pressure': 'Low pressure', discolouration: 'Discolouration', works: 'Works' };

    const OVERLAYS = {
        water: {
            label: 'Water notices', colour: '#2f6fd6',
            build: () => L.layerGroup((data.water?.notices || []).filter(n => n.lat != null).map(n =>
                L.circleMarker([n.lat, n.lon], {
                    radius: n.active ? 6 : 4.5, weight: 1.5, color: '#fff',
                    fillColor: WATER_COLOURS[n.kind] || '#2f6fd6', fillOpacity: n.active ? 0.95 : 0.55
                }).bindPopup(`<strong>${esc(n.title)}</strong><br>
                    <span class="pill">${esc(WATER_LABELS[n.kind] || n.kind)}</span>${n.active ? '<span class="pill warn">Now</span>' : '<span class="pill">Upcoming</span>'}<br>
                    <span class="popup-meta">${esc(when(n.start))} to ${esc(when(n.end))}</span>
                    <p style="margin-top:6px">${esc(n.description.slice(0, 280))}${n.description.length > 280 ? '…' : ''}</p>
                    <a href="https://www.water.ie/water-service-updates" target="_blank" rel="noopener">Uisce Éireann updates</a>`)
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
        }
    };

    function drawOverlays() {
        for (const [name, def] of Object.entries(OVERLAYS)) {
            overlayLayers[name]?.remove();
            overlayLayers[name] = def.build();
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
            renderControls(); updateHash();
        }
        const c = e.target.closest('[data-county]');
        if (c) { e.preventDefault(); selectCounty(c.dataset.county); }
        if (e.target.closest('[data-back]')) { e.preventDefault(); selectCounty(null); }
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
        const water = data.water?.notices || [];
        const rising = (data.rivers?.stations || []).filter(s => s.trend.startsWith('rising')).length;
        const h = data.housing?.national;

        const cards = [
            ['Weather warnings', w.length ? `${w.length} active` : 'None', top ? `Highest: ${top}` : 'Met Éireann'],
            ['Wind power', g?.windPercent != null ? `${g.windPercent}%` : '–', g ? `of demand · ${fmt(g.demandMW)} MW · ${fmt(g.co2)} gCO₂/kWh` : ''],
            ['Trains running', t ? fmt(t.running) : '–', t ? `${t.late} running 5+ min late` : ''],
            ['Buses tracked', data.buses ? fmt(data.buses.national.running) : '–', data.buses ? `${fmt(data.buses.national.late)} running 5+ min late` : ''],
            ['Water notices', fmt(water.filter(n => n.active).length), `${water.filter(n => !n.active).length} more due this week`],
            ['Rivers rising', data.rivers ? fmt(rising) : '–', data.rivers ? `of ${fmt(data.rivers.stations.length)} gauges` : ''],
            ['House prices', h ? euro(h.median) : '–', h ? `${pct(h.change)} on last year` : '']
        ];
        document.getElementById('national').innerHTML = cards.map(([label, value, sub]) =>
            `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`).join('');
    }

    // ---------- County panel ----------

    function section(title, body, link) {
        return `<section class="section"><h3><span>${esc(title)}</span>${link ? `<a href="${esc(link[1])}" target="_blank" rel="noopener">${esc(link[0])} ↗</a>` : ''}</h3>${body}</section>`;
    }

    const unavailable = '<p class="empty">Not available right now.</p>';

    function countyPanel(id) {
        const f = counties.find(x => x.properties.id === id);
        const p = f.properties;
        let html = `<a href="#" data-back class="muted">← All of Ireland</a>
            <h2 style="margin-top:6px">${esc(p.name)}</h2><div class="irish">${esc(p.irish)} · ${esc(p.province)}</div>`;

        // Warnings
        if (data.warnings) {
            const list = data.warnings.warnings.filter(w => w.counties.includes(id));
            html += section('Weather warnings', list.length ? list.map(w => `
                <div class="warning ${esc(w.level)}"><strong>${esc(w.headline)}</strong>
                <span class="muted">${esc(when(w.onset))} to ${esc(when(w.expiry))}</span>
                <p>${esc(w.description)}</p></div>`).join('') : '<p class="soft">No warnings in force.</p>', ['met.ie', 'https://www.met.ie/warnings']);
        }

        // Weather
        const we = data.weather?.counties?.[id];
        html += section('Weather now', we ? `
            <div class="row"><span class="big">${esc(we.temperature.toFixed(1))}°C</span><span class="soft">${esc(we.description)}</span></div>
            <p class="soft">Wind ${esc(we.windSpeed)} km/h, gusts ${esc(we.windGust)} km/h</p>
            <p class="muted">Today ${esc(we.todayMin.toFixed(0))}° to ${esc(we.todayMax.toFixed(0))}°, ${esc(we.todayRain.toFixed(1))} mm rain expected</p>` : unavailable);

        // Water notices
        if (data.water) {
            const list = data.water.notices.filter(n => n.county === id).sort((a, b) => b.active - a.active || a.start.localeCompare(b.start));
            html += section(`Water notices (${list.length})`, list.length ? `<ul class="list">${list.slice(0, 8).map(n => `
                <li><strong>${esc(n.title)}</strong><br>
                <span class="pill">${esc(WATER_LABELS[n.kind] || n.kind)}</span>${n.active ? '<span class="pill warn">Now</span>' : ''}
                <span class="meta">${esc(when(n.start))} to ${esc(when(n.end))}</span></li>`).join('')}</ul>
                ${list.length > 8 ? `<p class="muted">and ${list.length - 8} more</p>` : ''}` : '<p class="soft">No current or upcoming notices.</p>',
                ['water.ie', 'https://www.water.ie/water-service-updates']);
        } else html += section('Water notices', unavailable);

        // Rivers
        if (data.rivers) {
            const list = data.rivers.stations.filter(s => s.county === id);
            const known = list.filter(s => s.change != null).sort((a, b) => b.change - a.change);
            const rising = known.filter(s => s.trend.startsWith('rising'));
            html += section(`Rivers (${list.length} gauges)`, !list.length ? '<p class="soft">No OPW gauges in this county.</p>'
                : !known.length ? '<p class="soft">Rising and falling trends appear after a few hours of readings.</p>'
                    : `<p class="soft">${rising.length ? `<strong>${rising.length}</strong> rising` : 'None rising'} in the last 6 hours.</p>
                    <ul class="list">${known.slice(0, 5).map(s => `<li>${esc(s.name)} <span class="trend ${s.change > 0 ? 'up' : 'down'}">${s.change > 0 ? '+' : ''}${(s.change * 100).toFixed(0)} cm</span>
                    <span class="meta">${esc(s.level.toFixed(2))} m</span></li>`).join('')}</ul>`, ['waterlevel.ie', 'https://waterlevel.ie/']);
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
        if (data.buses || data.trains) {
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

        // House prices
        const h = data.housing?.counties?.[id];
        html += section('House prices', h ? `
            <div class="row"><span class="big">${esc(euro(h.median))}</span>
            <span class="pill ${h.change > 0 ? 'up' : h.change < 0 ? 'down' : ''}">${esc(pct(h.change))} on last year</span></div>
            <p class="muted">Median of ${esc(fmt(h.sales))} sales in the last 12 months</p>` : unavailable, ['Property Price Register', 'https://www.propertypriceregister.ie/']);

        // Beaches
        const bc = data.beaches?.counties?.[id];
        if (data.beaches) {
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
        html += section('People', pop ? `
            <div class="row"><span class="big">${esc(fmt(pop.population))}</span><span class="soft">people (Census 2022)</span></div>
            <p class="muted">${esc(fmt(pop.density))} per km² · ${esc(fmt(pop.areaKm2))} km²</p>` : unavailable, ['CSO', 'https://data.cso.ie/table/FY003A']);

        // TDs
        if (data.tds) {
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
            <p class="panel-intro">Click any county for its warnings, weather, water notices, rivers, beaches, house prices, population and TDs. Use the buttons above the map to colour the counties or show live points.</p>
            ${section('Weather warnings', w.length ? w.map(x => `<div class="warning ${esc(x.level)}"><strong>${esc(x.headline)}</strong>
                <span class="muted">until ${esc(when(x.expiry))}</span></div>`).join('') : '<p class="soft">No warnings in force.</p>', ['met.ie', 'https://www.met.ie/warnings'])}
            ${data.water ? ranked(id => { const c = data.water.counties[id]; return c ? c.active + c.upcoming : null; }, 'Most water notices', v => `${v} notices`) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.median, 'Highest house prices', euro) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.change, 'Fastest-rising prices', pct) : ''}
            ${data.weather ? ranked(id => data.weather.counties[id]?.temperature, 'Warmest right now', v => `${v.toFixed(1)}°C`) : ''}`;
    }

    function renderPanel() {
        const panel = document.getElementById('panel');
        panel.innerHTML = selected ? countyPanel(selected) : nationalPanel();
        panel.scrollTop = 0;
    }

    function selectCounty(id) {
        selected = id;
        renderPanel();
        restyle();
        updateHash();
        if (id && window.matchMedia('(max-width: 860px)').matches) {
            document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        L.popup({ autoPan: false })
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
        if (county) selectCounty(county);
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
        status = statusRes?.ok ? await statusRes.json() : null;

        renderControls();
        renderLegend();
        drawCounties();
        drawOverlays();
        renderNational();
        renderMeta();
        selectCounty(counties.some(f => f.properties.id === initialCounty) ? initialCounty : null);
    }

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
        selectCounty(counties.some(f => f.properties.id === county) ? county : null);
    });

    start().catch(error => {
        console.error(error);
        document.getElementById('panel').innerHTML = `<p class="empty">Couldn't load the data: ${esc(error.message)}</p>`;
    });
})();
