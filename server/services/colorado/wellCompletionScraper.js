// Colorado's well construction/yield data (depth, pump rate, static water
// level) lives on a per-permit detail page that isn't part of the bulk API
// and blocks direct browser fetch — no CORS headers. That's exactly why
// this needs to run server-side instead of in the browser prototype.
//
// Verified live (2026-08-12) against https://dwr.state.co.us/Tools/WellPermits/{receipt}:
// despite looking like a JS single-page app (tabs, Kendo grids), the page is
// fully server-rendered — a plain HTTP GET returns all tab content already
// in the HTML, including the "Construction Data" tab. No headless browser
// needed. Every data field on the page is marked with a stable
// `data-fieldName` attribute on a <label>, with the value in the next <td>
// in the same row — that's what this parser keys off, not visible text or
// tab position, so it should keep working even if the page's layout changes.
//
// NOTE: the briefing doc's guess at this URL (WellPermitSearch/View.aspx?
// receipt=X) is outdated. The real, confirmed-live path is
// /Tools/WellPermits/{receipt} (also what the bulk API's own
// `moreInformation` field points to).
const cheerio = require('cheerio');
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');

const detailUrl = (receipt) => `https://dwr.state.co.us/Tools/WellPermits/${encodeURIComponent(receipt)}`;

// Construction detail is a matter of public record and changes rarely once
// a well is built, so caching aggressively saves hammering a slow
// government page on every lookup.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new TtlCache();

// key -> [human label, unit]. Keys are the site's own `data-fieldName`
// values, confirmed against a live sample page (receipt 0000072A, Weld
// County) — see docs/colorado-well-scraper-notes.md for how these were found.
const FIELD_MAP = {
  driller: ['Driller', null],
  date_well_completed: ['Date well completed', null],
  depth_total: ['Total depth', 'ft'],
  top_perforated_casing: ['Top perforated casing', 'ft'],
  bottom_perforated_casing: ['Bottom perforated casing', 'ft'],
  static_water_level: ['Static water level', 'ft'],
  estimated_production_rate: ['Estimated production rate', 'GPM'],
  as_built_aquifers: ['Constructed aquifer(s)', null],
  const_aquifer_type: ['Constructed aquifer type', null],
  pump_installer: ['Pump installer', null],
  date_pump_installed: ['Date pump installed', null],
  production_yield_rate: ['Production test yield', 'GPM'],
};

const HEADER_KEYS = ['permit', 'permit_category_descr', 'permit_current_status_descr', 'receipt', 'associated_wdid'];

// Every `data-fieldName`-labeled value on the page, not just the ones this
// project currently knows how to name nicely. This is the raw-fields
// fallback (see briefing §3.2) — it's how a wrong/missing entry in
// FIELD_MAP gets caught, instead of silently dropping data the state adds
// or renames later.
function extractAllLabeledFields($) {
  const out = {};
  $('label[data-fieldname]').each((_, el) => {
    const $label = $(el);
    const key = $label.attr('data-fieldname');
    if (!key || out[key] !== undefined) return; // first occurrence wins
    const tr = $label.closest('tr');
    const valueText = tr.find('> td').eq(1).text().replace(/\s+/g, ' ').trim();
    out[key] = valueText || null;
  });
  return out;
}

function pick(rawFields, keys) {
  const out = {};
  for (const key of keys) out[key] = rawFields[key] ?? null;
  return out;
}

function buildKnownFields(rawFields) {
  const known = {};
  for (const [key, [label, unit]] of Object.entries(FIELD_MAP)) {
    const value = rawFields[key];
    known[key] = { label, unit, value: value || null };
  }
  return known;
}

// A reported yield/production rate of 0 usually means "not measured," not
// "no water" (briefing §3.4) — flag it explicitly rather than letting a
// caller treat 0 as a real reading.
function annotateZeroReadings(known) {
  for (const key of ['estimated_production_rate', 'production_yield_rate']) {
    const entry = known[key];
    if (entry.value !== null && Number(entry.value) === 0) {
      entry.note = 'A value of 0 here typically means "not measured," not "no water."';
    }
  }
}

async function scrapeWellCompletion(receipt, { skipCache = false } = {}) {
  if (!receipt || typeof receipt !== 'string') {
    throw new Error('scrapeWellCompletion requires a receipt number string');
  }

  const cacheKey = receipt.toUpperCase();
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };
  }

  const url = detailUrl(receipt);
  const res = await fetchWithTimeout(url);

  if (res.status === 404) {
    return { notFound: true, receipt, sourceUrl: url };
  }
  if (!res.ok) {
    throw new Error(`Well permit detail page responded with status ${res.status} for receipt ${receipt}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const rawFields = extractAllLabeledFields($);

  const header = pick(rawFields, HEADER_KEYS);
  const construction = buildKnownFields(rawFields);
  annotateZeroReadings(construction);

  const hasAnyConstructionDetail = Object.values(construction).some((f) => f.value !== null);

  const result = {
    receipt,
    sourceUrl: url,
    permitNumber: header.permit,
    permitCategory: header.permit_category_descr,
    permitStatus: header.permit_current_status_descr,
    wdid: header.associated_wdid,
    construction,
    hasAnyConstructionDetail,
    rawFields, // full fallback dump — every data-fieldName found on the page
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };

  cache.set(cacheKey, result, CACHE_TTL_MS);
  return result;
}

module.exports = { scrapeWellCompletion, detailUrl };
