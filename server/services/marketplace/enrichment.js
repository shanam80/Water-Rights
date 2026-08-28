// Verifies a marketplace listing's claimed right_identifier against the
// real state record, rather than trusting free-text entry alone — reusing
// the same per-state lookup services already built for the main state
// pages instead of duplicating that logic. Best-effort and non-blocking:
// a listing is always saved whether or not this succeeds (see
// listings.js), same graceful-degradation pattern as email notifications.
//
// Colorado and Idaho both support looking a right up directly by its own
// identifier (confirmed live 2026-08-27). Utah's public API does not —
// its bounding-box endpoint silently ignores a wrnum filter, and the
// state's own "print" detail page is a JS-heavy app, not a simple scrape
// target like Colorado's or Utah's own well-log pages. So Utah gets an
// honest partial result: a link to the official record, no live-verified
// fields, rather than a fabricated one.
const { getWaterRightByWdid } = require('../colorado/waterRights');
const { getWaterRightByNumber } = require('../idaho/waterRights');

async function enrichListing(state, rightIdentifier) {
  if (!rightIdentifier || !rightIdentifier.trim()) return null;
  const id = rightIdentifier.trim();

  try {
    if (state === 'CO') {
      const right = await getWaterRightByWdid(id);
      if (!right) return { verified: false, state, rightIdentifier: id, checkedAt: new Date().toISOString() };
      return {
        verified: true,
        state,
        rightIdentifier: id,
        name: right.name,
        priorityDate: right.priorityDate,
        seniority: right.seniority,
        decreedUse: right.decreedUse,
        confirmedAmount: right.confirmedAmount,
        waterSource: right.waterSource,
        division: right.division,
        // Confirmed live 2026-08-27 (matches the same /Tools/{Feature}/{id}
        // pattern already used for Colorado well permits elsewhere in this
        // project) — a first guess at ?wdid= on the search-tool URL was
        // wrong (just shows the generic search form, ignores the param).
        officialRecordUrl: `https://dwr.state.co.us/tools/structures/${encodeURIComponent(id)}`,
        checkedAt: new Date().toISOString(),
      };
    }

    if (state === 'ID') {
      const right = await getWaterRightByNumber(id);
      if (!right) return { verified: false, state, rightIdentifier: id, checkedAt: new Date().toISOString() };
      return {
        verified: true,
        state,
        rightIdentifier: id,
        name: right.name,
        priorityDate: right.priorityDate,
        status: right.status,
        decreedUse: right.use,
        waterSource: right.source,
        totalAcres: right.totalAcres,
        officialRecordUrl: right.officialRecordUrl,
        checkedAt: new Date().toISOString(),
      };
    }

    if (state === 'UT') {
      // No live direct-lookup path exists (see note above) — an honest
      // "not independently verified" result, plus the one thing we can
      // still offer: a working link to the state's own record for this
      // number, so a buyer can check it themselves.
      return {
        verified: false,
        state,
        rightIdentifier: id,
        officialRecordUrl: `https://waterrights.utah.gov/asp_apps/wrprint/wrprint.asp?wrnum=${encodeURIComponent(id)}`,
        checkedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error(`Listing enrichment failed for ${state} ${id}:`, err.message);
    return null;
  }

  return null;
}

module.exports = { enrichListing };
