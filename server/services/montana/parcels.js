// Montana's statewide cadastral parcels — confirmed live 2026-08-15 at
// gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/MapServer/0 (a
// different, earlier-guessed URL at gisservicemt.gov turned out to be
// dead — that agency is mid-migration to a new GIS provider, exactly the
// kind of stale-citation trap the project briefing warns about). Genuinely
// rich: owner name/address, acreage broken down by land use (irrigated,
// grazing, forest, etc.), and assessed values — arguably more detailed
// than Colorado's equivalent.
const { fetchWithTimeout } = require('../../lib/http');

const PARCELS_URL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/MapServer/0/query';

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
