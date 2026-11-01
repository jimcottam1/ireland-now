// NOAA Space Weather Prediction Center: the planetary Kp index, and what it means for seeing the
// Northern Lights from Ireland (roughly 53–55°N, so it takes a strong storm).
const { getJson } = require('../lib/http');

const SOURCE = {
    name: 'NOAA Space Weather Prediction Center',
    url: 'https://www.swpc.noaa.gov/products/planetary-k-index',
    licence: 'US government public domain'
};

/** Rough guide to aurora visibility from Ireland for a given Kp, on a clear dark night. */
function auroraChance(kp) {
    if (kp >= 7) return { level: 'good', text: 'Good chance across Ireland' };
    if (kp >= 6) return { level: 'possible', text: 'Possible, especially in the north' };
    if (kp >= 5) return { level: 'low', text: 'Low: northern coasts, on camera' };
    return { level: 'none', text: 'Unlikely' };
}

async function fetchSpace() {
    const rows = await getJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
    const now = Date.now();
    const parsed = rows
        .filter(r => r.time_tag && r.kp != null)
        .map(r => ({ time: new Date(r.time_tag + 'Z'), kp: Number(r.kp), observed: r.observed }));

    const observed = parsed.filter(r => r.observed === 'observed' || r.observed === 'estimated');
    const latest = observed[observed.length - 1];
    if (!latest) throw new Error('NOAA Kp file held no observed values');
    // Highest predicted Kp over the next 24 hours
    const next = parsed.filter(r => r.time > now - 3 * 3600000 && r.time < now + 24 * 3600000 && r.observed === 'predicted');
    const peak = next.reduce((best, r) => (r.kp > (best?.kp ?? -1) ? r : best), null);
    const outlookKp = Math.max(latest?.kp ?? 0, peak?.kp ?? 0);

    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        national: {
            kp: latest ? Number(latest.kp.toFixed(1)) : null,
            kpTime: latest?.time.toISOString() || null,
            peakKp: peak ? Number(peak.kp.toFixed(1)) : null,
            peakTime: peak?.time.toISOString() || null,
            aurora: auroraChance(outlookKp),
            // Last 3 days, for a small chart
            history: observed.slice(-24).map(r => [r.time.toISOString(), Number(r.kp.toFixed(2))])
        }
    };
}

module.exports = { fetchSpace };
