// After a build: open a GitHub issue for any data source that has been failing for more than a day,
// and close the issue again once it recovers. Runs in GitHub Actions with the gh CLI and GH_TOKEN.
// A layer that's only reusing a cached copy on purpose (daily or monthly sources) is fine; only
// layers whose fetch failed this run count, and only once their last good copy is over a day old.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { redact } = require('./lib/redact');

const STALE_HOURS = 24;
const LABEL = 'data-source';
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, '..', 'site');

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const titleFor = name => `Data source failing: ${name}`;

function main() {
    const status = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'status.json'), 'utf8'));
    const now = Date.now();
    const failing = new Map();
    for (const [name, s] of Object.entries(status.layers)) {
        if (s.ok) continue;
        const age = s.updatedAt ? (now - new Date(s.updatedAt).getTime()) / 3600000 : Infinity;
        if (age > STALE_HOURS) failing.set(name, { ...s, age });
    }

    try { gh('label', 'create', LABEL, '--color', 'd93f0b', '--description', 'A data source has stopped updating'); } catch { /* already exists */ }
    const open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,title', '--limit', '100'));

    for (const [name, s] of failing) {
        if (open.some(i => i.title === titleFor(name))) continue;
        const body = [
            `The **${name}** layer has failed on every build for more than ${STALE_HOURS} hours, so the site is showing old data.`,
            '',
            `- Last error: \`${redact(s.error || 'unknown').slice(0, 300)}\``,
            `- Last good data: ${s.updatedAt ? `${s.updatedAt} (${Math.round(s.age)} hours ago)` : 'none'}`,
            `- Build: ${process.env.GITHUB_SERVER_URL || ''}/${process.env.GITHUB_REPOSITORY || ''}/actions/runs/${process.env.GITHUB_RUN_ID || ''}`,
            '',
            'This issue closes itself when the layer starts working again.'
        ].join('\n');
        gh('issue', 'create', '--title', titleFor(name), '--label', LABEL, '--body', body);
        console.log(`Opened issue for ${name}`);
    }

    for (const issue of open) {
        const name = issue.title.replace('Data source failing: ', '');
        if (!failing.has(name) && status.layers[name]?.ok) {
            gh('issue', 'close', String(issue.number), '--comment', `Working again as of ${status.builtAt}.`);
            console.log(`Closed issue for ${name}`);
        }
    }
    console.log(failing.size ? `${failing.size} source(s) failing for over ${STALE_HOURS} hours` : 'All sources fresh enough');
}

main();
