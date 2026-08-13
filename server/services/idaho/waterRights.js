// Idaho's water-rights data, ported from the browser prototype. Unlike
// Colorado, Idaho represents each water right as an actual place-of-use
// polygon rather than a point, spread across several layers by stage
// (claim, permit, license/decree). This endpoint is CORS-enabled, but it's
// moved here anyway so a single request can query every stage in parallel
// and return one combined, translated result.
const { fetchWithTimeout } = require('../../lib/http');
const { findVal, findFuzzy, fmtDatePlain } = require('../../lib/fields');

// The original maps.idwr.idaho.gov service for these layers is dead
// (confirmed — it now 404s). This is a live mirror on IDWR's current
// platform. Its folder is literally named "WillBeDeleted" — a signal this
// may not be permanent either, worth re-checking if this ever breaks again.
const WR_SERVICE_ROOT = 'https://gis.idwr.idaho.gov/hosting/rest/services/WillBeDeleted/WaterRights/MapServer';

const STAGE_COLORS = {
  claim: '#a8643f', permit: '#4a6fa5', recommendation: '#b8863a',
  license: '#3f6b4a', decree: '#3f6b4a', default: '#8a8a7a',
};
function colorForStageName(name) {
  const n = name.toLowerCase();
  if (n.includes('claim')) return STAGE_COLORS.claim;
  if (n.includes('permit')) return STAGE_COLORS.permit;
  if (n.includes('recommend')) return STAGE_COLORS.recommendation;
  if (n.includes('licen') || n.includes('decree') || n.includes('water right')) return STAGE_COLORS.license;
  return STAGE_COLORS.default;
}

// Discover the actual "POU" (Place of Use) layers and their index numbers
// live, rather than trust hardcoded guesses — this service's exact layer
// numbering isn't fully confirmed, and this is more robust regardless.
// Cached in memory since the service's layer list essentially never
// changes between requests.
let cachedLayers = null;
async function discoverWaterRightLayers() {
  if (cachedLayers) return cachedLayers;
  const res = await fetchWithTimeout(`${WR_SERVICE_ROOT}?f=json`);
  if (!res.ok) throw new Error(`Could not read the water rights service structure (status ${res.status}).`);
  const data = await res.json();
  const layers = (data.layers || []).filter((l) => /pou/i.test(l.name));
  if (layers.length === 0) throw new Error('No place-of-use layers found in this service — its structure may have changed.');
  cachedLayers = layers.map((l) => ({
    id: l.id,
    name: l.name,
    label: l.name.replace(/^POU\s*-\s*/i, ''),
    color: colorForStageName(l.name),
  }));
  return cachedLayers;
}

async function queryWaterRightLayer(layer, lat, lon) {
  try {
    const url = `${WR_SERVICE_ROOT}/${layer.id}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { layer, error: `Status ${res.status}` };
    const data = await res.json();
    if (data.error) return { layer, error: data.error.message || 'Service returned an error.' };
    return { layer, features: data.features || [] };
  } catch (err) {
    return { layer, error: `Could not reach this layer: ${err.message}` };
  }
}

function isLargePOUFlag(attrs) {
  const v = findFuzzy(attrs, 'largepou');
  return v !== null && String(v) !== '0' && String(v).toLowerCase() !== 'false' && String(v).toLowerCase() !== 'no';
}

// Builds the plain-language view of one water right feature, alongside the
// raw attributes (see briefing §3.2 — always keep a raw-fields fallback).
function translateWaterRightFeature(feature, layer) {
  const attrs = feature.attributes;
  const wrNumber = findVal(attrs, ['WaterRightNumber']);
  const owner = findVal(attrs, ['Owner']);
  const priorityDate = findVal(attrs, ['PriorityDate']);
  const dateCompleted = findVal(attrs, ['DateCompleted', 'ConstructionDate', 'DrillDate']);

  return {
    name: owner || `Water right ${wrNumber || ''}`.trim(),
    wrNumber,
    status: findVal(attrs, ['Status']),
    priorityDate: { raw: priorityDate, plain: fmtDatePlain(priorityDate) },
    source: findVal(attrs, ['Source']),
    tributaryOf: findVal(attrs, ['TributaryOf']),
    use: findVal(attrs, ['WaterUse']),
    totalAcres: findVal(attrs, ['TotalAcres']),
    basis: findVal(attrs, ['Basis']),
    officialRecordUrl: findVal(attrs, ['WRReport']),
    isLargePOU: isLargePOUFlag(attrs),
    layer: { id: layer.id, label: layer.label, color: layer.color },
    geometry: feature.geometry && feature.geometry.rings ? { rings: feature.geometry.rings } : null,
    raw: attrs,
    dateCompleted: { raw: dateCompleted, plain: fmtDatePlain(dateCompleted) },
  };
}

// Queries every water-right stage layer (claim, permit, license/decree) at
// one point in parallel, and returns them combined and translated. Mirrors
// handlePointSelected()'s water-rights portion in the prototype.
async function searchWaterRightsAtPoint(lat, lon) {
  const layers = await discoverWaterRightLayers();
  const results = await Promise.all(layers.map((layer) => queryWaterRightLayer(layer, lat, lon)));

  const rights = [];
  const layerErrors = [];
  for (const result of results) {
    if (result.error) {
      layerErrors.push({ layer: result.layer.label, error: result.error });
      continue;
    }
    for (const feature of result.features) {
      rights.push(translateWaterRightFeature(feature, result.layer));
    }
  }
  return { rights, layerErrors };
}

module.exports = { discoverWaterRightLayers, queryWaterRightLayer, searchWaterRightsAtPoint, translateWaterRightFeature };
