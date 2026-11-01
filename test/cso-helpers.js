// Helpers for the CSO JSON-stat tests: read a saved table, look values up independently of the
// layer code (by dimension-id prefix and exact label), and edit values to make awkward situations.
const { fixture } = require('./helpers');

/** A fresh copy of a saved table, e.g. table('MUM01'). */
const table = name => JSON.parse(fixture(`cso-${name}.json`).toString());

/** Every offset in raw.value whose categories match `picks` ({ dimension id prefix: exact label }). Dimensions left out match anything. */
function offsets(raw, picks) {
    const dims = raw.id.map((id, i) => {
        const key = Object.keys(picks).find(k => id.startsWith(k));
        const cat = raw.dimension[id].category;
        const keep = cat.index.map((code, pos) => ({ code, pos })).filter(({ code }) => !key || cat.label[code] === picks[key]);
        if (key && !keep.length) throw new Error(`No "${picks[key]}" in ${id}`);
        return keep.map(k => k.pos);
    });
    let out = [0];
    dims.forEach((positions, d) => {
        out = out.flatMap(base => positions.map(p => base * raw.size[d] + p));
    });
    return out;
}

/** One value by exact labels (every dimension named). */
function get(raw, picks) {
    const o = offsets(raw, picks);
    if (o.length !== 1) throw new Error(`Expected one value, matched ${o.length}`);
    return raw.value[o[0]];
}

/** Sum of the matching values (nulls count as zero). */
const sum = (raw, picks) => offsets(raw, picks).reduce((s, o) => s + (raw.value[o] || 0), 0);

/** Replace every matching value: set(raw, picks, 5) or set(raw, picks, old => old * 2). */
function set(raw, picks, to) {
    for (const o of offsets(raw, picks)) raw.value[o] = typeof to === 'function' ? to(raw.value[o]) : to;
    return raw;
}

/** Copy the values for one category to another in the same dimension (all other dimensions alike), through fn. */
function copy(raw, prefix, fromLabel, toLabel, fn = v => v) {
    const from = offsets(raw, { [prefix]: fromLabel });
    const to = offsets(raw, { [prefix]: toLabel });
    from.forEach((o, i) => { raw.value[to[i]] = raw.value[o] == null ? null : fn(raw.value[o]); });
    return raw;
}

/** The labels of one dimension, in order. */
const labels = (raw, prefix) => {
    const id = raw.id.find(i => i.startsWith(prefix));
    const cat = raw.dimension[id].category;
    return cat.index.map(c => cat.label[c]);
};

module.exports = { table, get, sum, set, copy, labels };
