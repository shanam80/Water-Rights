// New Mexico water rights — Office of the State Engineer Points of Diversion.
//
// Choosing the right endpoint was the real work here, because at least six
// mirrors of this same layer exist across NM government domains and most are
// stale or unusable. Checked live 2026-09-24:
//
//   x-23.env.nm.gov/arcgis/.../nmose/pod      unreachable
//   arcgis.env.nm.gov/server/.../nmose/pod    unreachable
//   gis.ose.nm.gov/server_s/.../watersPods    "Token Required"
//   gis.oseisc.org/enterprise/.../watersPods  "Token Required"
//   mercator.env.nm.gov/server/.../nmose/pod  live, but no currency date
//   services2.arcgis.com/qXZbWTdPDbTjl7Dy/... live, "as of September 1, 2026"
//
// The last is used: it's the service behind OSE's own ArcGIS Open Data hub,
// owned by the `osegis` account, and it states the most recent currency date
// by a margin of years — the mirrors that do publish dates say 2016 and 2018.
// The project brief pointed at catalog.newmexicowaterdata.org as the place to
// confirm this, but that catalog returns 403 to any automated request, so the
// OSE's own hub item was used instead.
//
// 279,991 points of diversion statewide at time of writing.
//
// No separate wells dataset is needed for New Mexico, and that was measured
// rather than assumed (2026-09-28). This one layer already carries the well
// itself, and carries it well: of 279,991 records, 196,924 give a well depth
// (70%), 182,572 a casing size (65%) and 158,573 a depth to water (57%).
// For contrast, Texas's log-depth coverage tops out near 2%. Sparser here:
// static level 6%, discharge 3%, aquifer 1% — all handled as "not recorded"
// rather than shown as zero.
//
// The one adjacent OSE well dataset was checked and rejected on the numbers.
// OSE_Aquifer_Test_Wells_view_pub holds richer data — pumping rate, screen
// interval, formation, geologic description — but only 3,455 rows statewide,
// one per test rather than per well, and only 730 of them carry a POD record
// number. So it can enrich roughly 0.26% of points of diversion and cannot
// serve as a wells layer. It would only work as its own "aquifer tests near
// here" feature, which is a new feature, not a gap in this one.
//
// Worth knowing, unbuilt: OSE also publishes DeclaredGroundwaterBasins on
// this same host (39 polygons, verified to resolve Albuquerque to the Rio
// Grande basin). Inside a declared basin a permit is required to drill;
// outside one, groundwater is largely unregulated. That is the same class of
// signal as services/administrativeAreas.js flags for the other states, and
// New Mexico is not wired into it yet.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');
const { haversineMiles } = require('../../lib/geo');
const { translatePod } = require('./translate');

const POD_URL =
  'https://services2.arcgis.com/qXZbWTdPDbTjl7Dy/arcgis/rest/services/OSE_Points_of_Diversion/FeatureServer/0';

// Matches the convention used for Idaho/Utah/Nevada/Texas.
const DEFAULT_RADIUS_MILES = 1.2;
const MAX_RESULTS = 40;

const cache = new TtlCache();
const CACHE_TTL_MS = 60 * 60 * 1000;

// The fields actually used by translate.js. Requesting these rather than *
// keeps the payload sane — the layer carries 103 columns.
const OUT_FIELDS = [
  'OBJECTID', 'pod_basin', 'pod_nbr', 'pod_suffix', 'pod_name', 'pod_file', 'pod_rec_nb',
  'own_lname', 'own_fname', 'city', 'state',
  'status', 'pod_status', 'use_', 'county', 'legal', 'tws', 'rng', 'sec',
  'depth_well', 'depth_wate', 'static_lev', 'casing_siz', 'discharge', 'pump_type',
  'grnd_wtr_s', 'surface_co', 'aquifer', 'elevation',
  'total_div', 'cfs_start_', 'start_date', 'finish_dat', 'plug_date',
  'nmwrrs_wrs', 'metered',
].join(',');

async function searchWaterRightsNearPoint(lat, lon, radiusMiles = null) {
  const radius = radiusMiles || DEFAULT_RADIUS_MILES;
  const key = `${lat.toFixed(5)},${lon.toFixed(5)},${radius}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(Math.round(radius * 1609.34)),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  const res = await fetchWithTimeout(`${POD_URL}/query?${params.toString()}`, {}, 30000);
  if (!res.ok) throw new Error(`OSE points-of-diversion service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OSE service returned an error.');

  const rights = (data.features || [])
    .map(translatePod)
    .map((r) => ({
      ...r,
      distanceMiles: r.location ? haversineMiles(lat, lon, r.location.lat, r.location.lon) : null,
    }))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));

  const result = {
    rights: rights.slice(0, MAX_RESULTS),
    fetchedCount: rights.length,
    truncated: rights.length > MAX_RESULTS,
    searchRadiusMiles: radius,
  };
  cache.set(key, result, CACHE_TTL_MS);
  return result;
}

// Direct lookup by file number (e.g. RG-00872), for verifying a marketplace
// listing's claimed identifier against the real record.
async function getWaterRightByFileNumber(fileNumber) {
  const clean = String(fileNumber || '').trim().toUpperCase();
  if (!clean) return null;

  const params = new URLSearchParams({
    where: `UPPER(pod_file) = '${clean.replace(/'/g, "''")}'`,
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '5',
    f: 'json',
  });

  const res = await fetchWithTimeout(`${POD_URL}/query?${params.toString()}`, {}, 20000);
  if (!res.ok) throw new Error(`OSE service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OSE service returned an error.');

  const features = data.features || [];
  if (features.length === 0) return null;
  return translatePod(features[0]);
}

module.exports = { searchWaterRightsNearPoint, getWaterRightByFileNumber, POD_URL, DEFAULT_RADIUS_MILES };
