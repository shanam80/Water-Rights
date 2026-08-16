// Nevada's Well Driller Reports — confirmed live 2026-08-15. Unlike every
// other state in this project, this bulk-queryable data already includes
// full construction detail (depth, static water level, yield, drawdown,
// casing) directly — no separate scraper needed at all, not even
// Montana's "well depth only" middle ground. Also includes a direct link
// to the scanned well log PDF for anything the structured fields don't
// cover.
const { fetchWithTimeout } = require('../../lib/http');
const { findVal, fmtDatePlain } = require('../../lib/fields');
const { haversineMiles } = require('../../lib/geo');

const WELLS_URL = 'https://arcgis.water.nv.gov/arcgis/rest/services/NDWR/Well_Driller_Reports/FeatureServer/0/query';

const SEARCH_RADIUS_METERS = 2000; // roughly 1.2 miles, matches the water-rights search radius
const MAX_RESULTS = 8;

// A reported yield of 0 (or a blank field) usually means "not measured,"
// not "this well produces no water" — flag it explicitly rather than
// showing a bare 0 that reads as a real, and misleading, measurement.
function translateWellFeature(feature, targetLat, targetLon) {
  const attrs = feature.attributes;
  const lat = attrs.latitude;
  const lon = attrs.longitude;
  const location = lat != null && lon != null ? { lat, lon } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;

  const yieldRaw = findVal(attrs, ['yield']);
  const yieldEntry =
    yieldRaw === null
      ? null
      : {
          value: Number(yieldRaw),
          unit: 'GPM',
          note: Number(yieldRaw) === 0 ? 'Recorded as 0 — likely means not measured, not necessarily a dry well.' : null,
        };

  const startDate = findVal(attrs, ['WellStartDate']);
  const finishDate = findVal(attrs, ['WellFinishDate']);

  return {
    wellLog: findVal(attrs, ['WellLog']),
    wellName: findVal(attrs, ['WellName']),
    siteType: findVal(attrs, ['SiteType']),
    workType: findVal(attrs, ['WorkType']),
    proposedUse: findVal(attrs, ['ProposedUse']),
    drillingMethod: findVal(attrs, ['DrillingMethod']),
    depthDrilledFt: findVal(attrs, ['DepthDrilled']),
    depthCasedFt: findVal(attrs, ['DepthCased']),
    casingDiameterIn: findVal(attrs, ['CasingDiameter']),
    topPerforationFt: findVal(attrs, ['TopPerforation']),
    bottomPerforationFt: findVal(attrs, ['BottomPerforation']),
    staticWaterLevelFt: findVal(attrs, ['StaticWaterLevel']),
    yield: yieldEntry,
    drawdownFt: findVal(attrs, ['drawdown']),
    wellStartDate: { raw: startDate, plain: fmtDatePlain(startDate) },
    wellFinishDate: { raw: finishDate, plain: fmtDatePlain(finishDate) },
    ownerCurrent: findVal(attrs, ['OwnerCurrent']),
    contractorName: findVal(attrs, ['ContractorName']),
    legalLocation: [findVal(attrs, ['Township']), findVal(attrs, ['Range']), findVal(attrs, ['Section'])].filter(Boolean).join(' '),
    remarks: findVal(attrs, ['remarks']),
    wellLogReportUrl: findVal(attrs, ['WellLogReport']),
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

  return { wells, searchRadiusMiles: SEARCH_RADIUS_METERS / 1609.34 };
}

module.exports = { findNearbyWells };
