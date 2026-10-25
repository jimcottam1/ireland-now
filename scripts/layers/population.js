// CSO Census 2022 population, by county (local authorities combined: Dublin's four, Cork's and Galway's two).
const { getJson } = require('../lib/http');
const { countyFromName, counties: shapes } = require('../lib/geo');

const SOURCE = {
    name: 'CSO Census 2022 (FY003A)',
    url: 'https://data.cso.ie/table/FY003A',
    licence: 'CC BY 4.0'
};

/** Area of a county's shape in km², for population density (rough: spherical, from simplified boundaries). */
function areaKm2(feature) {
    const R = 6371;
    let total = 0;
    for (const rings of feature.geometry.coordinates) {
        rings.forEach((ring, i) => {
            let a = 0;
            for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
                const [x1, y1] = ring[j];
                const [x2, y2] = ring[k];
                a += (x2 - x1) * Math.PI / 180 * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
            }
            total += (i === 0 ? 1 : -1) * Math.abs(a * R * R / 2);
        });
    }
    return total;
}

async function fetchPopulation() {
    const raw = await getJson('https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/FY003A/JSON-stat/2.0/en');

    // JSON-stat: values are a flat array ordered by the dimensions in raw.id
    const [, , sexDim, areaDim] = raw.id;
    const sexes = raw.dimension[sexDim].category;
    const areas = raw.dimension[areaDim].category;
    const sexIndex = Object.entries(sexes.label).find(([, l]) => /both/i.test(l))[0];
    const sexPos = sexes.index.indexOf(sexIndex);
    const areaCount = areas.index.length;

    const counties = {};
    areas.index.forEach((code, pos) => {
        const id = countyFromName(areas.label[code]);
        if (!id) return; // "Ireland" total
        const value = raw.value[sexPos * areaCount + pos];
        counties[id] = counties[id] || { population: 0 };
        counties[id].population += value;
    });

    for (const f of shapes) {
        const c = counties[f.properties.id];
        if (!c) continue;
        c.areaKm2 = Math.round(areaKm2(f));
        c.density = Math.round(c.population / c.areaKm2);
    }

    return { updatedAt: new Date().toISOString(), source: SOURCE, year: 2022, counties };
}

module.exports = { fetchPopulation };
