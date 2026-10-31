// Ireland Now: front end. Loads the hourly data files and draws the map, overlays and county panel.
(function () {
    'use strict';

    const LAYERS = ['warnings', 'weather', 'observations', 'forecast', 'airquality', 'rivers', 'tides', 'marine', 'trains', 'buses', 'grid', 'water',
        'trolleys', 'space', 'earthquakes', 'fuel', 'economy', 'dail', 'beaches', 'tds', 'housing', 'population', 'placenames'];
    const data = {};
    let status = null;
    let counties = null;   // GeoJSON features
    let countyLayer = null;
    let selected = null;   // county id
    let view = 'warnings';
    const overlays = { water: true, stations: false, rivers: false, tides: false, buoys: false, quakes: false, trains: false, buses: false };
    const overlayLayers = {};

    // ---------- Helpers ----------

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => n == null ? '–' : Number(n).toLocaleString('en-IE');
    const euro = n => n == null ? '–' : '€' + Math.round(n / 1000).toLocaleString('en-IE') + 'k';
    const pct = n => n == null ? '–' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    const nameOf = id => counties?.find(f => f.properties.id === id)?.properties.name || id;

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
        air: {
            label: 'Air quality',
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
        homes: {
            label: 'New homes',
            stops: [[3, 'eef2f8'], [6, 'b6c8e6'], [10, '5f86c4'], [14, '23427f']],
            value: id => per1000(data.economy?.counties?.[id]?.newHomes, id),
            describe: v => v == null ? 'No data' : `${v.toFixed(1)} new homes per 1,000 people in a year`,
            ends: ['3', '14+ per 1,000'], title: 'New homes completed in the last year, per 1,000 people'
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
        document.getElementById('national').innerHTML = cards.map(([label, value, sub, note]) =>
            `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div>
            ${note ? `<div class="stat-asof${note.old ? ' old' : ''}"${note.old ? ' title="Older than this source is usually updated"' : ''}>${note.old ? '⚠ ' : ''}${esc(note.text)}</div>` : ''}</div>`).join('');
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
        const st = stationFor(id, f);
        html += section('Weather now', we ? `
            <div class="row"><span class="big">${esc(we.temperature.toFixed(1))}°C</span><span class="soft">${esc(we.description)}</span></div>
            <p class="soft">Wind ${esc(we.windSpeed)} km/h, gusts ${esc(we.windGust)} km/h</p>
            <p class="muted">Today ${esc(we.todayMin.toFixed(0))}° to ${esc(we.todayMax.toFixed(0))}°, ${esc(we.todayRain.toFixed(1))} mm rain expected</p>
            ${st ? `<p class="station">Measured at <strong>${esc(st.name)}</strong>${st.county !== id ? ` (nearest station, Co. ${esc(nameOf(st.county))})` : ''}:
                ${esc(st.temperature ?? '–')}°C, wind ${esc(st.windKmh ?? '–')} km/h, ${esc(st.rainToday)} mm rain so far today <span class="muted">at ${esc(st.time)}</span></p>` : ''}` : unavailable,
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
        if (data.trolleys) {
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

        // Earthquakes
        const quakes = (data.earthquakes?.quakes || []).filter(q => q.county === id);
        if (quakes.length) {
            html += section(`Earthquakes in the last year (${quakes.length})`, `<ul class="list">${quakes.slice(0, 5).map(q => `
                <li>Magnitude ${esc(q.magnitude)} <span class="meta">${esc(when(q.time))} · ${esc(q.depthKm)} km deep</span></li>`).join('')}</ul>
                <p class="muted">Small tremors recorded by the Irish National Seismic Network; most are too small to feel.</p>`, ['INSN', 'https://www.insn.ie/']);
        }

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
            <p class="panel-intro">Click any county for its warnings, weather and forecast, air quality, hospital trolleys, water notices, rivers, beaches, jobs, new homes, house prices, population and TDs. Use the buttons above the map to colour the counties or show live points.</p>
            ${section('Weather warnings', w.length ? w.map(x => `<div class="warning ${esc(x.level)}"><strong>${esc(x.headline)}</strong>
                <span class="muted">until ${esc(when(x.expiry))}</span></div>`).join('') : '<p class="soft">No warnings in force.</p>', ['met.ie', 'https://www.met.ie/warnings'])}
            ${data.water ? ranked(id => { const c = data.water.counties[id]; return c ? c.active + c.upcoming : null; }, 'Most water notices', v => `${v} notices`) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.median, 'Highest house prices', euro) : ''}
            ${data.housing ? ranked(id => data.housing.counties[id]?.change, 'Fastest-rising prices', pct) : ''}
            ${data.weather ? ranked(id => data.weather.counties[id]?.temperature, 'Warmest right now', v => `${v.toFixed(1)}°C`) : ''}
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

    function spaceSection() {
        const s = data.space?.national;
        if (!s) return '';
        const nowLevel = s.kp != null ? kpLevel(s.kp) : null;
        const peakLevel = s.peakKp != null ? kpLevel(s.peakKp) : null;
        return section('Northern Lights', `
            <p class="soft"><strong>${esc(s.aurora.text)}.</strong> The Kp index is ${esc(s.kp ?? '–')} now${s.peakKp != null ? ` and forecast to reach ${esc(s.peakKp)} in the next 24 hours` : ''}.</p>
            ${spark([{ values: s.history.map(r => r[1]), colour: '#7c3aed', label: 'Kp, last 3 days' }], { labels: ['3 days ago', 'now'], min: 0 })}
            <div class="kp-title">What the numbers mean in Ireland</div>
            <ul class="kp-guide">${KP_GUIDE.map(g => `
                <li class="${g === nowLevel ? 'kp-now' : ''}">
                    <span class="kp-num" style="background:${g.colour}">${g.min === g.max ? g.min : `${g.min}–${g.max}`}</span>
                    <span><strong>${esc(g.name)}</strong>${g === nowLevel ? ' <span class="pill warn">Now</span>' : ''}${g === peakLevel && g !== nowLevel ? ' <span class="pill">Next 24 hrs</span>' : ''}<br>
                    <span class="meta">${esc(g.text)}</span></span>
                </li>`).join('')}</ul>
            <p class="muted">Kp runs from 0 to 9 and measures how disturbed Earth's magnetic field is; the higher it is, the further south the aurora reaches.
            Ireland usually needs Kp 5 or more. A clear sky, a dark spot and a view of the northern horizon matter as much as the number.
            Phone cameras pick up colour the eye can't.</p>`,
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
