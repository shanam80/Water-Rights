// Wyoming's live water-rights data — confirmed live 2026-08-17. The state's
// own e-Permit / GIS Search tool (seoweb.wyo.gov) requires a login with no
// public access, matching what earlier research found. But the Wyoming
// State Geological Survey hosts a public "Groundwater Atlas" ArcGIS
// service that pulls directly from the State Engineer's Office (WSEO) —
// found by loading the Atlas's live web app (portal.wsgs.wyo.gov) and
// capturing its real network requests, the same dev-tools technique that
// found Utah's and Idaho's real endpoints. Note the REST path is
// `/ags/rest/services/...`, not the standard `/arcgis/rest/services/...` —
// a direct URL guess at the usual pattern fails.
//
// Two layers, near-identical schema, combined here: wells (groundwater
// rights with well construction detail already attached — depth, static
// water level) and springs. This genuinely covers Wyoming's groundwater
// permits. It does NOT cover surface-water points of diversion (ditches/
// canals off a stream) or reservoirs — that data appears to live only in
// the login-walled e-Permit system; not available through this route.
const { fetchWithTimeout } = require('../../lib/http');
const { haversineMiles } = require('../../lib/geo');

const BASE_URL = 'https://portal.wsgs.wyo.gov/ags/rest/services/Groundwater/Groundwater_Atlas/MapServer';
const LAYERS = [
  { id: 0, kind: 'Well' },
  { id: 1, kind: 'Spring' },
];

const SEARCH_RADIUS_METERS = 3200; // ~2 miles — Wyoming's permits skew rural/sparse compared to other states
const MAX_RESULTS = 10;

function fmtDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function translateFeature(feature, kind, targetLat, targetLon) {
  const attrs = feature.attributes;
  const lat = Number(attrs.Latitude);
  const lon = Number(attrs.Longitude);
  const location = !isNaN(lat) && !isNaN(lon) ? { lat, lon } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;

  const owner = attrs.Company || [attrs.FirstName, attrs.LastName].filter(Boolean).join(' ') || null;
  const legalLocation = [attrs.Twn, attrs.Rng, attrs.Sec ? `Sec ${attrs.Sec}` : null, attrs.QtrQtr].filter(Boolean).join(' ') || null;

  return {
    kind,
    wrNumber: attrs.WR_Number || null,
    permitNumber: attrs.PermitNumber || null,
    facilityName: attrs.FacilityName || null,
    owner,
    status: attrs.SummaryWRStatus || null,
    priorityDate: fmtDate(attrs.PriorityDate),
    uses: attrs.Uses || null,
    legalLocation,
    appropriationGpm: attrs.Appropriation_GPM ?? null,
    totalFlowCfsOrGpm: attrs.TotalFlow_CFS_Appropriation_GPM ?? null,
    totalCapacityAcreFeetPerYear: attrs.Total_Capacity_AfYr ?? null,
    totalDepthFt: attrs.TotalDepth_Ft ?? null,
    staticWaterLevelFt: attrs.StaticWaterLevel_Ft ?? null,
    streamSource: attrs.StreamSource || null,
    facilityType: attrs.FacilityType || null,
    distanceMiles,
    location,
    raw: attrs,
  };
}

async function queryLayer(layerId, kind, lat, lon) {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(SEARCH_RADIUS_METERS),
    units: 'esriSRUnit_Meter',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '100',
    f: 'json',
  });
  const res = await fetchWithTimeout(`${BASE_URL}/${layerId}/query?${params.toString()}`);
  if (!res.ok) throw new Error(`Wyoming groundwater service responded with status ${res.status} for layer ${layerId}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || `Wyoming groundwater service returned an error for layer ${layerId}.`);
  return (data.features || []).map((f) => translateFeature(f, kind, lat, lon));
}

async function findNearbyGroundwaterRights(lat, lon) {
  const results = await Promise.all(LAYERS.map((l) => queryLayer(l.id, l.kind, lat, lon)));
  const rights = results
    .flat()
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_RESULTS);

  return { rights, searchRadiusMiles: SEARCH_RADIUS_METERS / 1609.34 };
}

module.exports = { findNearbyGroundwaterRights };
