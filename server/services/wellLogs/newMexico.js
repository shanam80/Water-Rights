// New Mexico oil & gas well logs — different agency, different stack, same
// output shape as texas.js so the map, popup and page never branch on state.
//
// Verified live 2026-09-02:
//   Wells: mapservice.nmstatelands.org/.../Public/NMOCD_Wells_V3/MapServer/5
//          ("NMOCD_Active", 129,644 wells). V2 exists with an identical
//          schema and the same 129,644 count; V3 is used as the later
//          version. This layer is genuinely richer than Texas's — it
//          carries operator, well name, total depth, status and spud year
//          inline, which Texas's layer 1 does not.
//   Logs:  ocdimage.emnrd.nm.gov/imaging/WellFileView.aspx?RefType=WL&RefID=...
//          Plain GET, no auth, ~0.7s. Verified returning documents for the
//          reference well 30-045-08708.
//
// Two real differences from Texas, both handled rather than hidden:
//
// 1. There is no "which wells have logs" layer. Texas answers that with a
//    single query; here it takes one probe per well in the radius. That's
//    why the radius is capped lower and probes run in small batches.
//
// 2. NMOCD publishes NO log depth intervals at all — not top, not bottom.
//    So the depth control has nothing to run on and is hidden entirely for
//    New Mexico rather than shown dead or empty (supportsDepth: false).
//    The layer's meas_depth describes the hole, not the log inside it.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');
const { haversineMiles } = require('../../lib/geo');

const WELLS_URL =
  'https://mapservice.nmstatelands.org/arcgis/rest/services/Public/NMOCD_Wells_V3/MapServer/5/query';
const IMAGING_BASE = 'https://ocdimage.emnrd.nm.gov/imaging/WellFileView.aspx';

const cache = new TtlCache();
const CACHE_TTL_MS = 60 * 60 * 1000;
// Whether a given well has logs doesn't change day to day, and each answer
// costs a network round trip, so these are held far longer.
const probeCache = new TtlCache();
const PROBE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Because logs are found by probing, a huge radius means a huge number of
// probes. Capped so a wide search degrades into "too many wells to check"
// rather than thousands of outbound requests.
const MAX_PROBE_WELLS = 120;
const PROBE_CONCURRENCY = 6;

// NMOCD's imaging system keys on the API number with dashes stripped and
// four zeros appended — fully derivable, so no search step is needed.
// e.g. 30-045-08708 -> 30045087080000
function refIdForApi(api) {
  const digits = String(api || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `${digits.slice(0, 10)}0000`;
}

function logsUrlForApi(api) {
  const refId = refIdForApi(api);
  return refId ? `${IMAGING_BASE}?RefType=WL&RefID=${refId}` : null;
}

// NMOCD stores unknowns as sentinel values rather than nulls — verified in
// a live sample where 6 of 14 wells carried a sentinel spud year. Treating
// these literally would invent wells drilled in the year 9999, the same
// class of bug as Idaho's year-9999 priority dates.
function cleanSpudYear(value) {
  const year = Number(value);
  if (!year || year === 9999 || year === 1900) return null;
  return year;
}

function cleanDepth(value) {
  const depth = Number(value);
  return depth > 0 ? depth : null; // 0 means "not recorded", not "at surface"
}

// Counts log documents for one well. The page is server-rendered HTML, so
// the document links can be counted directly — no browser needed.
async function probeLogCount(api) {
  const url = logsUrlForApi(api);
  if (!url) return { logCount: 0, logsUrl: null };

  const cached = probeCache.get(api);
  if (cached) return cached;

  let result = { logCount: 0, logsUrl: url };
  try {
    const res = await fetchWithTimeout(url, {}, 20000);
    if (res.ok) {
      const html = await res.text();
      // Every document is referenced TWICE on the page — once as a full
      // filestore URL and once as a bare filename — so matching raw strings
      // double-counts (verified: the reference well 30-045-08708 has 3 logs
      // but yields 6 raw matches). Reducing each match to its basename
      // before de-duplicating gives the true count; checked against both
      // known cases, 3 logs and 0 logs.
      const matches = html.match(/[A-Za-z0-9_\-/.%]+\.(?:tif|tiff|pdf)/gi) || [];
      const documents = new Set(matches.map((m) => m.toLowerCase().split('/').pop()));
      result = { logCount: documents.size, logsUrl: url };
    }
  } catch {
    // A failed probe means "unknown", which is reported as zero logs rather
    // than a fabricated count; the well simply doesn't appear.
    result = { logCount: 0, logsUrl: url, probeFailed: true };
  }
  probeCache.set(api, result, PROBE_TTL_MS);
  return result;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function searchWellLogsNearPoint(lat, lon, radiusMiles) {
  const key = `nm:${lat.toFixed(5)},${lon.toFixed(5)},${radiusMiles}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const qs = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(Math.round(radiusMiles * 1609.34)),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'API,wellname,ogrid_name,county,meas_depth,year_spudd,status,well_type,type',
    returnGeometry: 'true',
    outSR: '4326',
  });

  const res = await fetchWithTimeout(`${WELLS_URL}?${qs.toString()}`, {}, 30000);
  if (!res.ok) throw new Error(`NMOCD well service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'NMOCD well service returned an error.');

  const candidates = (data.features || []).map((f) => ({
    api: f.attributes.API,
    wellName: f.attributes.wellname || null,
    operator: f.attributes.ogrid_name || null,
    county: f.attributes.county || null,
    status: f.attributes.status || null,
    wellType: f.attributes.type || f.attributes.well_type || null,
    totalDepthFt: cleanDepth(f.attributes.meas_depth),
    spudYear: cleanSpudYear(f.attributes.year_spudd),
    latitude: f.geometry?.y ?? null,
    longitude: f.geometry?.x ?? null,
  }));

  const sorted = candidates
    .map((w) => ({
      ...w,
      distanceMiles:
        w.latitude != null && w.longitude != null ? haversineMiles(lat, lon, w.latitude, w.longitude) : null,
    }))
    .sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));

  const toProbe = sorted.slice(0, MAX_PROBE_WELLS);
  const probes = await mapWithConcurrency(toProbe, PROBE_CONCURRENCY, (w) => probeLogCount(w.api));

  const wells = toProbe
    .map((w, i) => ({ ...w, ...probes[i] }))
    .filter((w) => w.logCount > 0);

  const result = {
    state: 'NM',
    wells,
    totalLogDocuments: wells.reduce((sum, w) => sum + w.logCount, 0),
    supportsDepth: false,
    wellsChecked: toProbe.length,
    wellsInRadius: sorted.length,
    truncated: sorted.length > MAX_PROBE_WELLS,
  };
  cache.set(key, result, CACHE_TTL_MS);
  return result;
}

module.exports = { searchWellLogsNearPoint, logsUrlForApi, refIdForApi };
