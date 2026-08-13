// Colorado's statewide parcel/ownership service. Ported from the browser
// prototype — this one is CORS-enabled and genuinely public (owner name/
// address, acreage, land use), which the briefing calls out as the single
// most important technical validation of the whole project: it proves
// parcel-to-owner matching is possible with free public data.
const { fetchWithTimeout } = require('../../lib/http');

const PARCEL_URL =
  'https://gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0/query';

async function fetchParcelAtPoint(lat, lon) {
  const url = `${PARCEL_URL}?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Parcel service responded with status ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || 'Parcel service returned an error.');
  }
  const feature = data.features?.[0];
  if (!feature) return { notFound: true };
  return { attributes: feature.attributes, rings: feature.geometry?.rings || null };
}

module.exports = { fetchParcelAtPoint };
