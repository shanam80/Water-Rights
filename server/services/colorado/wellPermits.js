// Colorado's bulk well permit feed. Ported from the browser prototype
// (colorado-water-rights-lookup.html) — this endpoint is CORS-enabled so it
// worked fine client-side, but it's moved here too so the server can pair a
// bulk record with its scraped detail page in one response.
const { fetchWithTimeout } = require('../../lib/http');

const BULK_URL = 'https://dwr.state.co.us/Rest/GET/api/v2/wellpermits/wellpermit/';

async function fetchWellPermitsByCounty(county) {
  const url = `${BULK_URL}?format=json&county=${encodeURIComponent(county.toUpperCase())}&pageSize=1000`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Well permit service responded with status ${res.status}`);
  }
  const data = await res.json();
  return data.ResultList || [];
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Well construction data is keyed by permit/receipt number, not by water
// right (WDID), so there's no guaranteed exact link between a specific
// water right and its permit record. This finds the geographically nearest
// permit on file in the same county as a best-effort match — real, but
// approximate, and should stay labeled as such wherever it's shown.
async function findNearestWellPermit(county, lat, lon) {
  const rows = await fetchWellPermitsByCounty(county);
  if (rows.length === 0) return { notFound: true };

  let best = null;
  let bestDist = Infinity;
  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) continue;
    const d = haversineMiles(lat, lon, row.latitude, row.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }
  if (!best) return { notFound: true, noCoords: true };
  return { row: best, distanceMiles: bestDist, totalOnFile: rows.length };
}

module.exports = { fetchWellPermitsByCounty, findNearestWellPermit, haversineMiles };
