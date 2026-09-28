// Wyoming parcels — the layer behind the state's own Statewide Parcel
// Viewer, a collaboration between Wyoming Enterprise Technology Services
// and all 23 county assessors.
//
// Verified live 2026-09-28: 373,666 parcels statewide, and — the part that
// actually matters — 333,159 of them (89.2%) carry an owner name. That was
// checked rather than assumed, because the first parcel tested happened to
// have a blank owner and would have made the whole layer look useless.
//
// Note a nearby dead end, so it isn't retried: gis.deq.wyo.gov publishes a
// "WY_PRIVATE_PARCELS" MapServer whose description promises exactly this
// data, but it exposes no layers at all — its layer list is empty and
// layer 0 errors. The hosted service below is the working one.
const { fetchWithTimeout } = require('../../lib/http');

const PARCELS_URL =
  'https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0/query';

async function fetchParcelAtPoint(lat, lon) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: [
      'parcelnb', 'accountno', 'jurisdicti', 'taxyear',
      'ownername1', 'ownername2', 'mailaddres', 'mailcity', 'mailstate', 'mailzipcod',
      'locationad', 'legal', 'landgrossa', 'actualvalu', 'assessedva',
    ].join(','),
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  const res = await fetchWithTimeout(`${PARCELS_URL}?${params.toString()}`, {}, 20000);
  if (!res.ok) throw new Error(`Wyoming parcel service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Wyoming parcel service returned an error.');

  const feature = (data.features || [])[0];
  if (!feature) return { notFound: true };
  return { attributes: feature.attributes, rings: feature.geometry?.rings || null };
}

module.exports = { fetchParcelAtPoint };
