// Irish local time (Europe/Dublin, which moves between GMT and IST) to ISO UTC.

/** Local wall-clock parts in Ireland -> ISO UTC string. */
function dublinToIso(year, month, day, hour = 0, minute = 0) {
    const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (Number.isNaN(asUtc.getTime())) return null;
    const wall = tz => new Date(asUtc.toLocaleString('en-US', { timeZone: tz }));
    return new Date(asUtc - (wall('Europe/Dublin') - wall('UTC'))).toISOString();
}

module.exports = { dublinToIso };
