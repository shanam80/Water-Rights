// Nevada's NDWR water-rights ArcGIS services — confirmed live 2026-08-15
// via the service's own discoverable catalog
// (arcgis.water.nv.gov/arcgis/rest/services/NDWR). Unlike Colorado/Montana,
// there's no reliable way to search "by county name" here — Nevada stores
// county as an opaque 2-letter code with no verified decode table (see
// translate.js), so this follows Idaho/Utah's point-only search pattern
// instead of Colorado/Montana's county-search pattern.
const { fetchWithTimeout } = require('../../lib/http');
const { haversineMiles, pointInRings } = require('../../lib/geo');
const { translateWaterRightFeature } = require('./translate');

const SERVICE_ROOT = 'https://arcgis.water.nv.gov/arcgis/rest/services/NDWR';
const DIVERSIONS_URL = `${SERVICE_ROOT}/Water_Rights_Points_of_Diversion/FeatureServer/0/query`;
const PLACES_OF_USE_URL = `${SERVICE_ROOT}/Water_Rights_Places_of_Use/FeatureServer/0/query`;

const SEARCH_RADIUS_METERS = 2000; // roughly 1.2 miles
const NEARBY_LIMIT = 20;

async function queryUrl(url, params) {
  const res = await fetchWithTimeout(`${url}?${new URLSearchParams(params).toString()}`);
  if (!res.ok) throw new Error(`Nevada NDWR service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Nevada NDWR service returned an error.');
  return data.features || [];
}

// Point-centered search: points of diversion within a radius, sorted by
// distance and flagged on-parcel (point-in-rings against the parcel
// boundary, passed in by the caller — same technique as Colorado/
// Montana), plus places of use whose polygon actually contains this exact
// point (Esri's own intersects test, same as Montana — no client-side
// polygon math needed).
async function searchWaterRightsNearPoint(lat, lon, { parcelRings = null } = {}) {
  const [diversionFeatures, placeOfUseFeatures] = await Promise.all([
    queryUrl(DIVERSIONS_URL, {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      distance: String(SEARCH_RADIUS_METERS),
      units: 'esriSRUnit_Meter',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '500',
      f: 'json',
    }),
    queryUrl(PLACES_OF_USE_URL, {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      // A single point can genuinely intersect thousands of place-of-use
      // records — confirmed live (a Reno test point hit the server's own
      // 2000-record transfer limit). That's real data, not a bug: many
      // individual water rights within one large irrigation district each
      // carry a copy of that same district-wide boundary, so this caps
      // the response rather than shipping thousands of near-duplicate
      // polygons. Deduplicated for map display by poly_id on the
      // frontend, same principle as Idaho's "draw the district outline
      // once" handling of its own Large POU shapes.
      resultRecordCount: '50',
      f: 'json',
    }),
  ]);

  const diversions = diversionFeatures.map((f) => {
    const translated = translateWaterRightFeature(f, 'diversion');
    const dist = translated.geometry?.type === 'point' ? haversineMiles(lat, lon, translated.geometry.lat, translated.geometry.lon) : Infinity;
    const onParcel = parcelRings && translated.geometry?.type === 'point' ? pointInRings(translated.geometry.lat, translated.geometry.lon, parcelRings) : false;
    return { ...translated, distanceMiles: dist, onParcel };
  });

  const onParcelRights = diversions.filter((r) => r.onParcel);
  const nearbyRights = diversions
    .filter((r) => !r.onParcel)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, NEARBY_LIMIT);

  const placesOfUse = placeOfUseFeatures.map((f) => translateWaterRightFeature(f, 'placeOfUse'));

  return {
    onParcelRights,
    nearbyRights,
    placesOfUse,
    fetchedCount: diversionFeatures.length,
    searchRadiusMiles: SEARCH_RADIUS_METERS / 1609.34,
  };
}

module.exports = { searchWaterRightsNearPoint };
