// Idaho's bulk wells feed, ported from the browser prototype. Unlike
// Colorado (permit status only, real construction data blocked behind a
// scraped detail page), Idaho's bulk data genuinely includes depth, static
// water level, and yield directly — no scraping needed here.
const { fetchWithTimeout } = require('../../lib/http');
const { findVal, fmtDatePlain } = require('../../lib/fields');
const { haversineMiles } = require('../../lib/geo');

const WELLS_URL = 'https://gis.idwr.idaho.gov/hosting/rest/services/groundwater/wells/MapServer/0/query';

const SEARCH_BUFFER_DEG = 0.02; // roughly ~1.3 miles at Idaho's latitude
const MAX_RESULTS = 8;

// A reported yield of 0 almost certainly means "not measured/not on file,"
// not "this well produces no water" — flag it explicitly rather than
// showing a bare 0 that reads as a real (and misleading) measurement.
function translateWellFeature(feature, targetLat, targetLon) {
  const attrs = feature.attributes;
  const pt = feature.geometry;
  const location = pt && pt.x !== undefined && pt.y !== undefined ? { lat: pt.y, lon: pt.x } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;

  const yieldRaw = findVal(attrs, ['ProductionRate', 'Yield', 'FlowRate', 'PumpingRate', 'WellYield']);
  const yieldEntry =
    yieldRaw === null
      ? null
      : {
          value: Number(yieldRaw),
          unit: 'GPM',
          note: Number(yieldRaw) === 0 ? 'Recorded as 0 — likely means not measured, not necessarily a dry well.' : null,
        };

  const dateCompleted = findVal(attrs, ['DateCompleted', 'ConstructionDate', 'DrillDate']);

  return {
    wellId: findVal(attrs, ['WellID', 'WellId', 'TagNumber', 'WellTagNumber']),
    depth: findVal(attrs, ['TotalDepth', 'WellDepth', 'DepthDrilled', 'Depth']),
    staticWaterLevel: findVal(attrs, ['StaticWaterLevel', 'WaterLevel', 'DepthToWater']),
    yield: yieldEntry,
    geology: findVal(attrs, ['GeologicUnit', 'Formation', 'Geology', 'StaticGeology']),
    owner: findVal(attrs, ['Owner']),
    wellUse: findVal(attrs, ['WellUse']),
    address: findVal(attrs, ['WellAddress']),
    casingDepth: findVal(attrs, ['CasingDepth']),
    casingDiameter: findVal(attrs, ['CasingDiameter']),
    dateCompleted: { raw: dateCompleted, plain: fmtDatePlain(dateCompleted) },
    distanceMiles,
    location,
    raw: attrs,
  };
}

// Wells are point features, so a small bounding box around the search
// point is queried rather than a strict intersects test (a single point
// rarely lands exactly on a well's coordinate), sorted by real distance.
async function findNearbyWells(lat, lon) {
  const envelope = {
    xmin: lon - SEARCH_BUFFER_DEG,
    ymin: lat - SEARCH_BUFFER_DEG,
    xmax: lon + SEARCH_BUFFER_DEG,
    ymax: lat + SEARCH_BUFFER_DEG,
    spatialReference: { wkid: 4326 },
  };
  const url = `${WELLS_URL}?geometry=${encodeURIComponent(JSON.stringify(envelope))}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Wells service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Wells service returned an error.');

  const features = data.features || [];
  const wells = features
    .map((f) => translateWellFeature(f, lat, lon))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_RESULTS);

  return { wells, searchRadiusMiles: 1.3 };
}

module.exports = { findNearbyWells };
