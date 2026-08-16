// TxGIO's StratMap statewide parcel dataset — confirmed live 2026-08-16.
// A first citation (feature.tnris.org, TNRIS being TxGIO's old pre-rebrand
// name) turned out to be a dead domain — exactly the kind of stale
// citation the project briefing warns about — this is a working
// replacement found via the item's current ArcGIS Online listing.
// Aggregates parcels from 245+ county appraisal districts into one
// common schema; ~90% coverage, not 100%, and update frequency varies by
// county — there's no single statewide "as of" date.
const { fetchWithTimeout } = require('../../lib/http');

const PARCELS_URL = 'https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/2019_Texas_Parcels_StratMap/FeatureServer/0/query';

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
