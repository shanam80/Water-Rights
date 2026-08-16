// Groundwater Conservation District boundaries — confirmed live
// 2026-08-16 at services.twdb.texas.gov/.../Base/GroundWaterConservationDistricts.
// Cross-checked against the project briefing's own example: a point near
// Waxahachie correctly returns "Prairielands GCD". Coverage isn't
// statewide — 81 of 254 counties have no GCD at all, which is a
// genuinely correct "not found" result, not a bug.
const { fetchWithTimeout } = require('../../lib/http');

const GCD_URL = 'https://services.twdb.texas.gov/arcgis/rest/services/Base/GroundWaterConservationDistricts/MapServer/0/query';

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

module.exports = { findGcdAtPoint };
