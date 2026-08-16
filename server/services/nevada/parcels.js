// Nevada's statewide parcel index — confirmed live 2026-08-15 at
// arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada.
// A different, restricted service at gis.dot.nv.gov (Statewide_Parcels)
// explicitly forbids sharing its data outside the department per NRS 250
// — deliberately not used here. This one is thinner than Colorado's or
// Montana's parcel data (no owner name, no acreage breakdown) — just the
// parcel number, acreage, and a link to that county assessor's own record
// — but it's genuinely public and still enables on-parcel matching via
// its boundary geometry.
const { fetchWithTimeout } = require('../../lib/http');

const PARCELS_URL = 'https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0/query';

async function fetchParcelAtPoint(lat, lon) {
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
  const res = await fetchWithTimeout(`${PARCELS_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Parcel service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Parcel service returned an error.');

  const feature = data.features?.[0];
  if (!feature) return { notFound: true };
  return { attributes: feature.attributes, rings: feature.geometry?.rings || null };
}

module.exports = { fetchParcelAtPoint };
