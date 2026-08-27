// TWDB's automated groundwater-level monitoring network, via
// waterdatafortexas.org — confirmed live 2026-08-27, a real public JSON API
// distinct from the bulk well index in wells.js. About 430 sensor wells
// statewide track depth-to-water continuously; this is NOT the same well
// index used elsewhere in this project, and does not include production/
// pumping-capacity data — depth to water tells you where the water table
// sits and whether it's trending, not how many gallons per minute a nearby
// well could actually produce. Presented to the user as regional
// groundwater-level context, not a per-well production estimate.
//
// recent-conditions.json gives the current reading per well but no
// location; the bulk GWDB layer (same one wells.js already queries) has
// location but not these readings. Cross-referenced here via a single
// POST query with an IN clause (429 well numbers is too long for a GET
// query string, confirmed live) rather than one request per well.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');
const { haversineMiles } = require('../../lib/geo');

const RECENT_CONDITIONS_URL = 'https://waterdatafortexas.org/groundwater/recent-conditions.json';
const GWDB_QUERY_URL = 'https://services.twdb.texas.gov/arcgis/rest/services/Public/TWDB_Groundwater_database/FeatureServer/0/query';
const wellPageUrl = (swn) => `https://waterdatafortexas.org/groundwater/well/${encodeURIComponent(swn)}`;

// New readings arrive hourly/daily; refreshing the merged list every 12h
// is plenty and avoids re-querying GWDB for all ~430 wells on every request.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new TtlCache();
const CACHE_KEY = 'texas-monitoring-wells';

// Monitoring wells are sparse (~430 statewide) — a tight radius like the
// bulk wells search uses would return nothing most of the time, so this
// searches much wider and is presented as regional context, not a
// hyperlocal "wells on file" list.
const SEARCH_RADIUS_MILES = 25;
const MAX_RESULTS = 3;

async function buildMonitoringWellList() {
  const recentRes = await fetchWithTimeout(RECENT_CONDITIONS_URL, {}, 20000);
  if (!recentRes.ok) throw new Error(`Water Data for Texas responded with status ${recentRes.status}`);
  const recentData = await recentRes.json();
  const readings = recentData.values || [];

  const wellNumbers = [...new Set(readings.map((r) => r.state_well_number).filter(Boolean))];
  if (wellNumbers.length === 0) return [];

  const whereClause = `StateWellNumber IN (${wellNumbers.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})`;
  const body = new URLSearchParams({
    where: whereClause,
    outFields: 'StateWellNumber,CoordDDLat,CoordDDLong,CountyName,AquiferCodeName',
    returnGeometry: 'false',
    f: 'json',
  });
  const locRes = await fetchWithTimeout(GWDB_QUERY_URL, { method: 'POST', body }, 20000);
  if (!locRes.ok) throw new Error(`GWDB location lookup responded with status ${locRes.status}`);
  const locData = await locRes.json();
  if (locData.error) throw new Error(locData.error.message || 'GWDB location lookup returned an error.');

  const locationByWell = new Map();
  (locData.features || []).forEach((f) => {
    const a = f.attributes;
    if (a.CoordDDLat != null && a.CoordDDLong != null) {
      locationByWell.set(a.StateWellNumber, { lat: a.CoordDDLat, lon: a.CoordDDLong, county: a.CountyName, aquifer: a.AquiferCodeName });
    }
  });

  return readings
    .map((r) => {
      const loc = locationByWell.get(r.state_well_number);
      if (!loc) return null; // reading exists but this well isn't in the bulk index — skip rather than guess a location
      return {
        stateWellNumber: r.state_well_number,
        depthToWaterFt: r['daily_high_water_level(ft below land surface)'] ?? null,
        asOfDate: r.date || null,
        location: { lat: loc.lat, lon: loc.lon },
        county: loc.county || null,
        aquifer: loc.aquifer || null,
        detailUrl: wellPageUrl(r.state_well_number),
      };
    })
    .filter(Boolean);
}

async function getMonitoringWellList() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;
  const list = await buildMonitoringWellList();
  cache.set(CACHE_KEY, list, CACHE_TTL_MS);
  return list;
}

async function findNearbyMonitoringWells(lat, lon) {
  const all = await getMonitoringWellList();
  const wells = all
    .map((w) => ({ ...w, distanceMiles: haversineMiles(lat, lon, w.location.lat, w.location.lon) }))
    .filter((w) => w.distanceMiles <= SEARCH_RADIUS_MILES)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, MAX_RESULTS);

  return { wells, searchRadiusMiles: SEARCH_RADIUS_MILES };
}

module.exports = { findNearbyMonitoringWells };
