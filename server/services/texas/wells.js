// Texas's TWDB Groundwater Database (GWDB) — confirmed live 2026-08-16 at
// services.twdb.texas.gov. This is the map-index layer: location, depth,
// owner, use, aquifer, county. Real construction detail (yield, static/
// pumping water level readings) lives behind a legacy SQL Server
// Reporting Services report viewer (reports.twdb.texas.gov via an
// internal proxy) that isn't reachable with a simple request — unlike
// every other state in this project, that richer detail isn't available
// here yet. Flagged honestly rather than silently omitted; see
// docs/project-briefing.md §8 and hasFullDetail below.
const { fetchWithTimeout } = require('../../lib/http');
const { haversineMiles } = require('../../lib/geo');

const WELLS_URL = 'https://services.twdb.texas.gov/arcgis/rest/services/Public/TWDB_Groundwater_database/FeatureServer/0/query';

const SEARCH_RADIUS_METERS = 2000; // roughly 1.2 miles, matches Idaho/Utah/Nevada's convention
const MAX_RESULTS = 8;

function translateWellFeature(feature, targetLat, targetLon) {
  const attrs = feature.attributes;
  const location = attrs.CoordDDLat != null && attrs.CoordDDLong != null ? { lat: attrs.CoordDDLat, lon: attrs.CoordDDLong } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;

  return {
    stateWellNumber: attrs.StateWellNumber,
    owner: attrs.OwnerName,
    primaryUse: attrs.PrimaryWaterUse,
    wellType: attrs.WellType,
    depthFt: attrs.WellDepth,
    elevationFt: attrs.Elevation,
    aquifer: attrs.AquiferCodeName,
    county: attrs.CountyName,
    waterQualityAvailable: attrs.WaterQualityAvailable === 'Y',
    waterLevelObservationType: attrs.WaterLevelObservationType,
    distanceMiles,
    location,
    raw: attrs,
  };
}

async function findNearbyWells(lat, lon) {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(SEARCH_RADIUS_METERS),
    units: 'esriSRUnit_Meter',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '200',
    f: 'json',
  });
  const res = await fetchWithTimeout(`${WELLS_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Wells service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Wells service returned an error.');

  const features = data.features || [];
  const wells = features
    .map((f) => translateWellFeature(f, lat, lon))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_RESULTS);

  return { wells, searchRadiusMiles: SEARCH_RADIUS_METERS / 1609.34, hasFullDetail: false };
}

module.exports = { findNearbyWells };
