// Utah's statewide cadastral parcels — confirmed live 2026-08-17 at
// arcgis.waterrights.utah.gov/arcgis/rest/services/Maps/Parcel_Service/MapServer/0
// (layer name "Utah_Parcels", the candidate the project briefing flagged as
// most likely given it's on the same domain family as the confirmed WRPOD
// water-rights service — that guess turned out right, verified against a
// real Salt Lake City point). UGRC aggregates all 29 counties into this one
// common schema. Real field names are lowercase (parcel_id, parcel_add, ...)
// — the briefing's UPPERCASE guesses (PARCEL_ID etc.) were wrong.
const { fetchWithTimeout } = require('../../lib/http');

const PARCELS_URL = 'https://arcgis.waterrights.utah.gov/arcgis/rest/services/Maps/Parcel_Service/MapServer/0/query';

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
  const attrs = feature.attributes;
  return {
    parcelId: attrs.parcel_id || null,
    address: attrs.parcel_add || null,
    city: attrs.parcel_city || null,
    zip: attrs.parcel_zip || null,
    ownerType: attrs.own_type || null,
    recorder: attrs.recorder || null,
    parcelYear: attrs.parcelyear || null,
    countyParcelUrl: attrs.coparcel_url || null,
    rings: feature.geometry?.rings || null,
    raw: attrs,
  };
}

module.exports = { fetchParcelAtPoint };
