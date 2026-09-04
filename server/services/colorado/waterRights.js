// Colorado's bulk water-rights feed, ported from the browser prototype.
// This endpoint is CORS-enabled, so it worked fine client-side — it's moved
// here anyway so a single search can combine it with the parcel service and
// return one enriched result, instead of the frontend juggling multiple
// direct government API calls itself.
const { fetchWithTimeout } = require('../../lib/http');
const { haversineMiles, pointInRings } = require('../../lib/geo');
const { translateWaterRight, rowLatLon } = require('./translate');

const BULK_URL = 'https://dwr.state.co.us/Rest/GET/api/v2/waterrights/netamount/';

// How many of the nearest off-parcel rights to keep when a search is
// centered on a point. Matches the prototype's behavior — a large batch is
// pulled so the true closest ones are guaranteed to be in the set sorted.
const NEARBY_LIMIT = 20;

async function fetchWaterRightsByCounty(county, pageSize = 1000) {
  const url = `${BULK_URL}?format=json&county=${encodeURIComponent(county.toUpperCase())}&pageSize=${pageSize}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`DWR responded with status ${res.status}`);
  }
  const data = await res.json();
  return { rows: data.ResultList || [], totalOnFile: data.ResultCount ?? (data.ResultList || []).length };
}

// Plain county search, no point to sort/filter by — just the translated
// list of everything on file (matches the prototype's original county-only
// form).
async function searchWaterRightsByCounty(county, pageSize = 1000) {
  const { rows, totalOnFile } = await fetchWaterRightsByCounty(county, pageSize);
  return {
    rights: rows.map(translateWaterRight),
    totalOnFile,
    fetchedCount: rows.length,
  };
}

// Point-centered search: fetches the county's rights, splits them into
// "on this parcel" (via point-in-polygon against the parcel's boundary
// rings) vs. "nearby," and sorts nearby by actual distance. Mirrors
// performSearch() in the prototype.
// Colorado's API is county-scoped rather than radius-scoped — there's no
// distance parameter to pass upstream. But every row already carries a
// computed distance, so a radius genuinely narrows the list here rather
// than being decorative: a county search can return hundreds of rights
// scattered dozens of miles away.
//
// Deliberately does NOT filter on-parcel rights. Those are on the parcel
// asked about, which is the question; hiding one because it sits just
// outside a radius would be wrong.
async function searchWaterRightsNearPoint(county, lat, lon, { pageSize = 1000, parcelRings = null, radiusMiles = null } = {}) {
  const { rows, totalOnFile } = await fetchWaterRightsByCounty(county, pageSize);
  const fetchedCount = rows.length;

  const withDistance = rows.map((row) => {
    const loc = rowLatLon(row);
    const dist = loc ? haversineMiles(lat, lon, loc.lat, loc.lon) : Infinity;
    const onParcel = parcelRings && loc ? pointInRings(loc.lat, loc.lon, parcelRings) : false;
    return { row, dist, onParcel };
  });
  withDistance.sort((a, b) => a.dist - b.dist);

  const onParcelRights = withDistance.filter((x) => x.onParcel).map((x) => translateWaterRight(x.row));

  const withinRadius = withDistance.filter(
    (x) => !x.onParcel && (!radiusMiles || x.dist <= radiusMiles)
  );
  const nearbyRights = withinRadius
    .slice(0, NEARBY_LIMIT)
    .map((x) => ({ ...translateWaterRight(x.row), distanceMiles: x.dist }));

  return {
    onParcelRights,
    nearbyRights,
    totalOnFile,
    fetchedCount,
    searchRadiusMiles: radiusMiles,
    // How many the radius excluded, so the page can offer to widen rather
    // than leaving someone wondering why a busy county looks empty.
    excludedByRadius: radiusMiles
      ? withDistance.filter((x) => !x.onParcel).length - withinRadius.length
      : 0,
    truncated: totalOnFile > fetchedCount,
  };
}

// Direct lookup by WDID — confirmed live 2026-08-27 that DWR's own API
// supports filtering on this field directly (?wdid=X), not just by county.
// Used to verify a marketplace listing's claimed right_identifier against
// the real record, rather than trusting free-text entry alone.
async function getWaterRightByWdid(wdid) {
  const url = `${BULK_URL}?format=json&wdid=${encodeURIComponent(wdid)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`DWR responded with status ${res.status}`);
  const data = await res.json();
  const row = (data.ResultList || [])[0];
  return row ? translateWaterRight(row) : null;
}

module.exports = { fetchWaterRightsByCounty, searchWaterRightsByCounty, searchWaterRightsNearPoint, getWaterRightByWdid };
