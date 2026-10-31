// Read values out of a CSO JSON-stat 2.0 dataset by naming the category you want in each dimension.
const { getJson } = require('./http');

const CSO = 'https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset';

const fetchCso = table => getJson(`${CSO}/${table}/JSON-stat/2.0/en`, { timeoutMs: 90000 });

/**
 * A lookup for one dataset. `pick` maps dimension id -> category code, or a function of the
 * category label that returns true for the wanted category. Dimensions left out vary freely.
 */
function cube(raw) {
    const dims = raw.id.map((id, i) => {
        const cat = raw.dimension[id].category;
        return { id, size: raw.size[i], index: cat.index, label: cat.label };
    });

    function codeFor(dim, want) {
        if (typeof want === 'function') return dim.index.find(code => want(dim.label[code], code));
        return want;
    }

    /** The value at one combination of categories (every dimension must be given). */
    function value(pick) {
        let offset = 0;
        for (const dim of dims) {
            const code = codeFor(dim, pick[dim.id]);
            const pos = dim.index.indexOf(code);
            if (pos < 0) return null;
            offset = offset * dim.size + pos;
        }
        return raw.value[offset] ?? null;
    }

    const dim = id => dims.find(d => d.id === id || d.id.startsWith(id));

    return { dims, dim, value, codeFor };
}

module.exports = { fetchCso, cube };
