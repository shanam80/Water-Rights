// Utah wells, in two parts:
//  1. A bulk index of well-log records (location, associated water right,
//     whether a log exists) from a public ArcGIS FeatureServer. This was
//     an unverified lead in the project briefing — confirmed live
//     (2026-08-13) and cross-checked against a real WRPOD record (its WIN
//     field matches a real well-log entry for the same water right).
//  2. The actual drilling-log detail page for one well (depth, casing,
//     water-level-over-time readings). Unlike Colorado's equivalent page,
//     this one is genuinely plain server-rendered HTML — no SPA shell to
//     worry about — so it's a simpler scrape than Colorado's.
const cheerio = require('cheerio');
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');
const { haversineMiles } = require('../../lib/geo');

const WELL_LOGS_LAYER_URL =
  'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Well_Logs/FeatureServer/0/query';
const wellLogDetailUrl = (win) => `https://waterrights.utah.gov/wellinfo/welldrilling/wlbrowse.asp?WIN=${encodeURIComponent(win)}`;

const SEARCH_BUFFER_DEG = 0.02; // roughly ~1.3 miles at Utah's latitude, matches Idaho's convention
const MAX_RESULTS = 8;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — drilling records rarely change once filed
const cache = new TtlCache();

function translateWellLogFeature(feature, targetLat, targetLon) {
  const attrs = feature.attributes;
  const location = attrs.Latitude != null && attrs.Longitude != null ? { lat: attrs.Latitude, lon: attrs.Longitude } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;

  return {
    win: attrs.WIN,
    associatedWaterRight: attrs.WRCHEX || null,
    legalLocation: attrs.Location || null,
    owner: attrs.Owner || null,
    hasGeologicLog: Number(attrs.Geol_Log) > 0,
    browseUrl: attrs.LINK || wellLogDetailUrl(attrs.WIN),
    distanceMiles,
    location,
    raw: attrs,
  };
}

async function findNearbyWellLogs(lat, lon) {
  const envelope = {
    xmin: lon - SEARCH_BUFFER_DEG,
    ymin: lat - SEARCH_BUFFER_DEG,
    xmax: lon + SEARCH_BUFFER_DEG,
    ymax: lat + SEARCH_BUFFER_DEG,
    spatialReference: { wkid: 4326 },
  };
  const url = `${WELL_LOGS_LAYER_URL}?geometry=${encodeURIComponent(JSON.stringify(envelope))}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Well logs service responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Well logs service returned an error.');

  const features = data.features || [];
  const wells = features
    .map((f) => translateWellLogFeature(f, lat, lon))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_RESULTS);

  return { wells, searchRadiusMiles: 1.3 };
}

// Table cell text on this page often has a <br> splitting a label across
// two lines ("Total Bore<br>Depth") with no whitespace between — insert a
// space in its place before extracting text, so labels read correctly.
function cellText($, el) {
  $(el).find('br').replaceWith(' ');
  return $(el).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// Each section of the page (Activity, Well Features, Comments, Water Level
// Records, Water Quality Records) is its own <table>, with a "pageBanner"
// title cell, a header row of ".columnHeader" cells, and one ".whitebar"
// row per record — or a single wide ".whitebar" cell reading "No ... found"
// when there's nothing on file. Column headers come straight off the page
// each time (not hardcoded), so this keeps working even if Utah reorders
// or renames a column.
function parseWellLogSections($) {
  const sections = {};
  $('table').each((_, table) => {
    const $table = $(table);
    const banner = $table.find('td.pageBanner').first();
    if (banner.length === 0) return;
    const bannerText = cellText($, banner[0]);

    const headers = $table.find('td.columnHeader').map((_, td) => cellText($, td)).get();
    if (headers.length === 0) return;

    const rows = [];
    $table.find('tr').each((_, tr) => {
      const cells = $(tr).find('td.whitebar');
      if (cells.length !== headers.length) return; // skips "No records found" rows and spacer rows
      const row = {};
      cells.each((i, td) => {
        row[headers[i]] = cellText($, td) || null;
      });
      rows.push(row);
    });
    sections[bannerText] = rows;
  });
  return sections;
}

async function scrapeWellLog(win, { skipCache = false } = {}) {
  if (!win) {
    throw new Error('scrapeWellLog requires a WIN (well identification number)');
  }

  const cacheKey = String(win);
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };
  }

  const url = wellLogDetailUrl(win);
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Well log page responded with status ${res.status} for WIN ${win}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections = parseWellLogSections($);

  const onclick = $('button[name="scannedWellLogButton"]').attr('onclick') || '';
  const folderMatch = onclick.match(/Folder=([^'")]+)/);
  const scannedLogUrl = folderMatch ? `http://waterrights.utah.gov/cgi-bin/docview.exe?Folder=${folderMatch[1]}` : null;

  const features = (sections['Well Features'] || [])[0] || null;

  const result = {
    win,
    sourceUrl: url,
    scannedLogUrl,
    activity: sections.Activity || [],
    features,
    comments: sections.Comments || [],
    waterLevelRecords: sections['Water Level Records'] || [],
    waterQualityRecords: sections['Water Quality Records'] || [],
    hasAnyConstructionDetail: !!features,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };

  cache.set(cacheKey, result, CACHE_TTL_MS);
  return result;
}

module.exports = { findNearbyWellLogs, scrapeWellLog };
