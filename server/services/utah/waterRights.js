// Utah's WRPOD (Water Rights Points of Diversion) data. Utah's Division of
// Water Rights runs its own custom query system, not a standard Esri REST
// FeatureServer — confirmed by capturing a real request from their own live
// map tool (see docs/project-briefing.md §2, Utah). The browser prototype
// had to use JSONP to reach this (bypassing CORS via a <script> tag), but
// that trick only exists to solve a browser problem: from a server there's
// no CORS restriction at all, and dropping the `callback` param this
// endpoint accepts returns plain JSON directly — confirmed live
// (2026-08-13), no JSONP parsing needed here.
const { fetchWithTimeout } = require('../../lib/http');
const { findVal } = require('../../lib/fields');
const { haversineMiles } = require('../../lib/geo');

const WRPOD_URL = 'https://maps.waterrights.utah.gov/EsriMap/EsriMapCompanion/query_POD_mode0.asp';

const SEARCH_BUFFER_DEG = 0.02; // roughly ~1.3 miles at Utah's latitude
const MAX_RESULTS = 10;

// Utah encodes some dates as a plain YYYYMMDD integer (e.g. 19521209 =
// December 9, 1952) rather than an epoch timestamp or ISO string —
// confirmed from real records (Priority: "19991230", "20160510", ...).
function fmtYYYYMMDD(val) {
  const str = String(val);
  if (!/^\d{8}$/.test(str)) return null;
  const year = Number(str.slice(0, 4));
  const month = Number(str.slice(4, 6));
  const day = Number(str.slice(6, 8));
  if (year < 1800 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Confirmed against real records: a record's single-letter "Uses" code
// lines up with which Use_* boolean flag is set (e.g. Uses: "M" paired
// with Use_Mun: "X"), which in turn matches the API's own useType filter
// option list (I,S,D,M,X,P,O) — not a blind guess.
const USE_CODES = { I: 'Irrigation', S: 'Stockwatering', D: 'Domestic', M: 'Municipal', X: 'Other', P: 'Power', O: 'Other' };
function decodeUse(code) {
  if (!code) return null;
  return String(code).split('').map((c) => USE_CODES[c] || c).join(', ');
}

// Builds the plain-language view of one point of diversion, alongside the
// raw record (see briefing §3.2 — always keep a raw-fields fallback).
function translatePOD(attrs, targetLat, targetLon) {
  const lat = Number(attrs.Lat);
  const lon = Number(attrs.Lon);
  const location = !isNaN(lat) && !isNaN(lon) ? { lat, lon } : null;
  const distanceMiles = location ? haversineMiles(targetLat, targetLon, location.lat, location.lon) : null;
  const priorityRaw = findVal(attrs, ['Priority']);

  return {
    wrNumber: findVal(attrs, ['WRNUM']),
    owner: findVal(attrs, ['Owner']),
    status: findVal(attrs, ['Status']),
    type: findVal(attrs, ['Type']),
    priorityDate: { raw: priorityRaw, plain: fmtYYYYMMDD(priorityRaw) },
    cfs: findVal(attrs, ['CFS']),
    acreFeet: findVal(attrs, ['Acft']),
    source: findVal(attrs, ['Source']),
    use: decodeUse(findVal(attrs, ['Uses'])),
    legalLocation: findVal(attrs, ['Location']),
    // WIN links this point of diversion to Utah's separate well-logs
    // dataset (server/services/utah/wells.js) — confirmed live by matching
    // a real WRPOD record's WIN to its corresponding well-log entry.
    wellIdNumber: findVal(attrs, ['WIN']),
    officialRecordUrl: attrs.WRNUM
      ? `https://waterrights.utah.gov/asp_apps/wrprint/wrprint.asp?wrnum=${encodeURIComponent(attrs.WRNUM)}`
      : null,
    distanceMiles,
    location,
    raw: attrs,
  };
}

async function findNearbyWaterRights(lat, lon) {
  const buffer = SEARCH_BUFFER_DEG;
  const params = new URLSearchParams({
    maxLat: lat + buffer,
    minLat: lat - buffer,
    maxLon: lon + buffer,
    minLon: lon - buffer,
    status: ' ,U,A,P',
    divType: 'Und,Sur,Spr,Dra,Poi,Red,Ret',
    useType: ',I,S,D,M,X,P,O',
    appType: 'WR,CH,EX,RE',
    source: '',
    owner: '',
    priorityGT: '',
    priorityLT: '',
    altMode: '0',
  });
  const res = await fetchWithTimeout(`${WRPOD_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`WRPOD service responded with status ${res.status}`);
  const data = await res.json();
  const records = Array.isArray(data.pods) ? data.pods : [];

  const rights = records
    .map((r) => translatePOD(r, lat, lon))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_RESULTS);

  return { rights, searchRadiusMiles: 1.3, serverMessage: data.message || null };
}

module.exports = { findNearbyWaterRights };
