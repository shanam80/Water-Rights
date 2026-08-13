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
async function searchWaterRightsNearPoint(county, lat, lon, { pageSize = 1000, parcelRings = null } = {}) {
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
  const nearbyRights = withDistance
    .filter((x) => !x.onParcel)
    .slice(0, NEARBY_LIMIT)
    .map((x) => ({ ...translateWaterRight(x.row), distanceMiles: x.dist }));

  return {
    onParcelRights,
    nearbyRights,
    totalOnFile,
    fetchedCount,
    truncated: totalOnFile > fetchedCount,
  };
}

module.exports = { fetchWaterRightsByCounty, searchWaterRightsByCounty, searchWaterRightsNearPoint };
