// Montana's WRQS (Water Right Query System) FeatureServer — confirmed
// live 2026-08-15 by inspecting the network requests of DNRC's own map
// tool (gis.dnrc.mt.gov/apps/WRQS/), same technique used for every other
// state in this project. Genuinely public, no token required despite the
// map app itself calling generateToken (that's the app being cautious,
// not the service requiring auth — confirmed by querying directly with a
// plain fetch and no token at all).
const { fetchWithTimeout } = require('../../lib/http');
const { haversineMiles, pointInRings } = require('../../lib/geo');
const { translateWaterRightFeature } = require('./translate');

const SERVICE_ROOT = 'https://gis.dnrc.mt.gov/arcgis/rest/services/WRD/WRQS/FeatureServer';
const LAYERS = { diversion: 1, placeOfUse: 2, reservoir: 3 };

const NEARBY_LIMIT = 20;

async function queryLayer(layerId, params) {
  const url = `${SERVICE_ROOT}/${layerId}/query?${new URLSearchParams(params).toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Montana WRQS service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Montana WRQS service returned an error.');
  return data.features || [];
}

function byCountyParams(county, extra = {}) {
  return {
    where: `UPPER(COUNTY)=UPPER('${county.replace(/'/g, "''")}')`,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '1000',
    f: 'json',
    ...extra,
  };
}

// Plain county search — everything on file for a county, no distance
// sorting or on-parcel matching (matches the prototype pattern's simple
// county-only form, same as Colorado's). No map is shown for this view, so
// geometry is skipped — a busy county can have thousands of point
// features, and requesting full geometry for all of them when nothing
// renders it was slow enough to trip the request timeout in practice.
async function searchWaterRightsByCounty(county) {
  const [diversions, reservoirs] = await Promise.all([
    queryLayer(LAYERS.diversion, byCountyParams(county, { returnGeometry: 'false' })),
    queryLayer(LAYERS.reservoir, byCountyParams(county, { returnGeometry: 'false' })),
  ]);

  const rights = [
    ...diversions.map((f) => translateWaterRightFeature(f, 'diversion')),
    ...reservoirs.map((f) => translateWaterRightFeature(f, 'reservoir')),
  ];
  return { rights, fetchedCount: rights.length };
}

// Point-centered search: points of diversion + reservoirs in the county,
// sorted by real distance and flagged on-parcel (via point-in-rings
// against the parcel's boundary, passed in by the caller — same technique
// as Colorado), plus places of use whose polygon actually contains this
// exact point. Unlike Idaho/Colorado, that polygon test doesn't need a
// client-side point-in-polygon reimplementation here — Esri's own spatial
// query does it server-side when queried with esriSpatialRelIntersects
// against a point geometry.
async function searchWaterRightsNearPoint(county, lat, lon, { parcelRings = null } = {}) {
  const [diversions, reservoirs, placesOfUseFeatures] = await Promise.all([
    queryLayer(LAYERS.diversion, byCountyParams(county)),
    queryLayer(LAYERS.reservoir, byCountyParams(county)),
    queryLayer(LAYERS.placeOfUse, {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    }),
  ]);

  const tagAndMeasure = (features, recordType) =>
    features.map((f) => {
      const translated = translateWaterRightFeature(f, recordType);
      const dist = translated.geometry?.type === 'point' ? haversineMiles(lat, lon, translated.geometry.lat, translated.geometry.lon) : Infinity;
      const onParcel = parcelRings && translated.geometry?.type === 'point' ? pointInRings(translated.geometry.lat, translated.geometry.lon, parcelRings) : false;
      return { ...translated, distanceMiles: dist, onParcel };
    });

  const pointRights = [...tagAndMeasure(diversions, 'diversion'), ...tagAndMeasure(reservoirs, 'reservoir')];

  const onParcelRights = pointRights.filter((r) => r.onParcel);
  const nearbyRights = pointRights
    .filter((r) => !r.onParcel)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, NEARBY_LIMIT);

  const placesOfUse = placesOfUseFeatures.map((f) => translateWaterRightFeature(f, 'placeOfUse'));

  return {
    onParcelRights,
    nearbyRights,
    placesOfUse,
    fetchedCount: diversions.length + reservoirs.length,
  };
}

module.exports = { searchWaterRightsByCounty, searchWaterRightsNearPoint };
