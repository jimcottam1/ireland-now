// A small CSV reader for files with quoted fields ("28,044", or text with commas and line breaks inside).

/** Rows of cells; the byte order mark is dropped and blank lines are skipped. */
function parseCsv(text) {
    const t = String(text).replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (quoted) {
            if (c === '"') {
                if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && t[i + 1] === '\n') i++;
            row.push(field);
            if (row.some(cell => cell.trim() !== '')) rows.push(row);
            row = [];
            field = '';
        } else field += c;
    }
    row.push(field);
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
    if (quoted) throw new Error('CSV ends inside a quoted field');
    return rows;
}

/** Rows as objects keyed by the header; throws if any named column is missing. */
function csvObjects(text, required = []) {
    const [header, ...rows] = parseCsv(text);
    if (!header) throw new Error('CSV is empty');
    const names = header.map(h => h.trim());
    const missing = required.filter(r => !names.includes(r));
    if (missing.length) throw new Error(`CSV columns changed (missing ${missing.join(', ')})`);
    return rows.map(cells => Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()])));
}

module.exports = { parseCsv, csvObjects };
