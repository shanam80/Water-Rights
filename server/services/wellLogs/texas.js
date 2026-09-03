// Texas oil & gas well logs, from the Railroad Commission's public map
// service. This is subsurface/industry data, deliberately kept out of the
// water-rights side of the site — see routes/wellLogs.js and well-logs.html.
//
// Verified live 2026-09-02 against
// gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs:
//   layer 1 = "Well Locations"  (1.4M wells)
//   layer 8 = "Well Logs"       (237,491 rows, ONE ROW PER LOG DOCUMENT)
//
// The key property of layer 8: a radius query returns only wells that
// actually have logs, so there's nothing to filter out afterwards. Grouping
// its rows by API gives both the set of wells to show and a free
// "how many logs" count.
//
// Confirmed limitation, not a bug: layer 8 carries API + geometry ONLY
// (verified — its full field list is API, OBJECTID, SHAPE). It cannot tell
// you how deep a log starts. Layer 1 adds a well number and symbology but
// no operator, lease, field, or depth either. Everything richer than that
// lives in RRC's monthly inventory spreadsheets — see inventory.js.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');
const { haversineMiles } = require('../../lib/geo');

const BASE = 'https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer';
const LOGS_LAYER = 8;
const WELLS_LAYER = 1;
const PAGE_SIZE = 1000; // the service's own maxRecordCount

const cache = new TtlCache();
const CACHE_TTL_MS = 60 * 60 * 1000;

// One well's log list on RRC's search system. This is as deep as a link can
// go: the URL never changes as you move into a record or open the viewer,
// because that's all client-side state. The last click is the user's.
function logsUrlForApi(api) {
  return `https://rrcsearch3.neubus.com/search-profile?profileId=15&search_fields-api_no=${encodeURIComponent(api)}`;
}

async function queryLayer(layer, params) {
  const qs = new URLSearchParams({ f: 'json', ...params });
  const res = await fetchWithTimeout(`${BASE}/${layer}/query?${qs.toString()}`, {}, 30000);
  if (!res.ok) throw new Error(`RRC map service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RRC map service returned an error.');
  return data.features || [];
}

// Layer 8 caps at 1,000 rows per request; a wide radius in a dense field
// exceeds that easily (a 5-mile Ward County search returns ~3,800 rows).
async function queryAllPages(layer, params) {
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await queryLayer(layer, { ...params, resultOffset: String(offset), resultRecordCount: String(PAGE_SIZE) });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (all.length > 20000) break; // hard stop; a radius this dense isn't usefully mappable anyway
  }
  return all;
}

function radiusParams(lat, lon, radiusMiles) {
  return {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(Math.round(radiusMiles * 1609.34)),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    returnGeometry: 'true',
    outSR: '4326',
  };
}

async function searchWellLogsNearPoint(lat, lon, radiusMiles) {
  const key = `tx:${lat.toFixed(5)},${lon.toFixed(5)},${radiusMiles}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // Step 1: every log document in the radius. These rows ARE the answer to
  // "which wells have logs" — wells without logs never come back.
  const logRows = await queryAllPages(LOGS_LAYER, { ...radiusParams(lat, lon, radiusMiles), outFields: 'API' });

  const byApi = new Map();
  for (const row of logRows) {
    const api = row.attributes?.API;
    if (!api) continue;
    if (!byApi.has(api)) {
      byApi.set(api, {
        api,
        logCount: 0,
        latitude: row.geometry?.y ?? null,
        longitude: row.geometry?.x ?? null,
      });
    }
    byApi.get(api).logCount += 1;
  }

  // Step 2: join to layer 1 for the well number and RRC's own symbology.
  // Best-effort: if this fails the logs themselves are still worth showing.
  if (byApi.size > 0) {
    try {
      const apis = [...byApi.keys()];
      for (let i = 0; i < apis.length; i += 200) {
        const batch = apis.slice(i, i + 200);
        const where = `API IN (${batch.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',')})`;
        const wells = await queryLayer(WELLS_LAYER, {
          where,
          outFields: 'API,GIS_WELL_NUMBER,GIS_SYMBOL_DESCRIPTION,GIS_LAT83,GIS_LONG83',
          returnGeometry: 'false',
        });
        for (const w of wells) {
          const entry = byApi.get(w.attributes.API);
          if (!entry) continue;
          entry.wellNumber = w.attributes.GIS_WELL_NUMBER || null;
          entry.wellType = w.attributes.GIS_SYMBOL_DESCRIPTION || null;
          // Operator-reported NAD83 coordinates, preferred over the log
          // symbol's position where present.
          if (w.attributes.GIS_LAT83 && w.attributes.GIS_LONG83) {
            entry.latitude = w.attributes.GIS_LAT83;
            entry.longitude = w.attributes.GIS_LONG83;
          }
        }
      }
    } catch (err) {
      console.error('RRC layer 1 join failed (logs still returned):', err.message);
    }
  }

  const wells = [...byApi.values()]
    .map((w) => ({
      ...w,
      logsUrl: logsUrlForApi(w.api),
      distanceMiles:
        w.latitude != null && w.longitude != null ? haversineMiles(lat, lon, w.latitude, w.longitude) : null,
    }))
    .sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));

  const result = { state: 'TX', wells, totalLogDocuments: logRows.length, supportsDepth: true };
  cache.set(key, result, CACHE_TTL_MS);
  return result;
}

module.exports = { searchWellLogsNearPoint, logsUrlForApi };
