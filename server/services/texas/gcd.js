// Groundwater Conservation District boundaries — confirmed live
// 2026-08-16 at services.twdb.texas.gov/.../Base/GroundWaterConservationDistricts.
// Cross-checked against the project briefing's own example: a point near
// Waxahachie correctly returns "Prairielands GCD". Coverage isn't
// statewide — 81 of 254 counties have no GCD at all, which is a
// genuinely correct "not found" result, not a bug.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');

const GCD_URL = 'https://services.twdb.texas.gov/arcgis/rest/services/Base/GroundWaterConservationDistricts/MapServer/0/query';

// District boundaries essentially never change, so the statewide set is
// cached aggressively. Without server-side generalization this payload is
// 18.4 MB — far too heavy for a web page. maxAllowableOffset (in degrees at
// outSR 4326) simplifies it to ~72 KB, a ~250x reduction, while keeping
// every district's shape intact (verified: no degenerate rings, ~37 points
// per district). Fine for a statewide overview map; the per-point lookup
// above still uses full-resolution geometry where precision matters.
const ALL_DISTRICTS_TTL_MS = 24 * 60 * 60 * 1000;
const STATEWIDE_SIMPLIFY_DEGREES = 0.01;
const allDistrictsCache = new TtlCache();

// Applies statewide regardless of which district (or none) covers a
// point — Texas Water Code caps production fees at these rates. Worth
// surfacing even for points outside any GCD, since it's true either way.
const STATEWIDE_PRODUCTION_FEE_CAP = {
  agriculturalPerAcreFoot: 1,
  otherPerAcreFoot: 10,
};

async function findGcdAtPoint(lat, lon) {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  const res = await fetchWithTimeout(`${GCD_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`GCD boundary service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'GCD boundary service returned an error.');

  const feature = data.features?.[0];
  if (!feature) {
    return { inDistrict: false, districtName: null, geometry: null, statewideProductionFeeCap: STATEWIDE_PRODUCTION_FEE_CAP };
  }
  return {
    inDistrict: true,
    districtName: feature.attributes.DistrictName,
    geometry: feature.geometry?.rings ? { type: 'polygon', rings: feature.geometry.rings } : null,
    statewideProductionFeeCap: STATEWIDE_PRODUCTION_FEE_CAP,
  };
}

// Every district boundary statewide, generalized for map display. Used by
// the district-browse map on texas.html. Note this layer returns 101
// features, not the ~98 GCDs — it also includes the Edwards Aquifer
// Authority and the Fort Bend / Harris-Galveston Subsidence Districts,
// which regulate groundwater under their own separate enabling
// legislation rather than Water Code Chapter 36. They're kept on the map
// (they genuinely regulate groundwater where they sit) but they have no
// GCD management plan, so they simply carry no restriction data.
async function fetchAllDistricts() {
  const cached = allDistrictsCache.get('all');
  if (cached) return cached;

  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'DistrictName',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(STATEWIDE_SIMPLIFY_DEGREES),
    f: 'json',
  });
  const res = await fetchWithTimeout(`${GCD_URL}?${params.toString()}`, {}, 30000);
  if (!res.ok) throw new Error(`GCD boundary service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'GCD boundary service returned an error.');

  const districts = (data.features || [])
    .filter((f) => f.geometry?.rings?.length)
    .map((f) => ({
      districtName: f.attributes.DistrictName,
      rings: f.geometry.rings,
    }));

  allDistrictsCache.set('all', districts, ALL_DISTRICTS_TTL_MS);
  return districts;
}

module.exports = { findGcdAtPoint, fetchAllDistricts, STATEWIDE_PRODUCTION_FEE_CAP };
