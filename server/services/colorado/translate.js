// Turns Colorado's raw water-rights field names/codes into plain language.
// Ported from the browser prototype's "translation layer" (colorado-water-
// rights-lookup.html) — this logic doesn't touch the network or the DOM, so
// it moves over unchanged. Every function only speaks up when it's confident
// what a field means; anything it doesn't recognize is left for the raw
// field dump instead of guessed at.

function findVal(row, aliases) {
  for (const a of aliases) {
    if (row[a] !== undefined && row[a] !== null && row[a] !== '') return row[a];
  }
  return null;
}

function findByPattern(row, pattern) {
  for (const key of Object.keys(row)) {
    if (pattern.test(key) && row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return { key, value: row[key] };
    }
  }
  return null;
}

function fmtDatePlain(val) {
  if (!val) return null;
  const dt = new Date(val);
  if (isNaN(dt) || dt.getFullYear() <= 1) return null;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Colorado's 7 water divisions, by basin — purely geographic/administrative,
// not an indicator of quality or value.
const CO_DIVISIONS = {
  1: 'South Platte basin',
  2: 'Arkansas basin',
  3: 'Rio Grande basin',
  4: 'Gunnison basin',
  5: 'Colorado River basin',
  6: 'Yampa/White basin',
  7: 'San Juan/Dolores basin',
};

function divisionLabel(div) {
  const num = parseInt(div, 10);
  if (CO_DIVISIONS[num]) return `Division ${num} — ${CO_DIVISIONS[num]}`;
  return `Division ${div}`;
}

// Colorado's "Decreed Units" field uses a single-letter code instead of
// spelling out cfs/acre-feet. C = cfs (flow rate), A = acre-feet (volume).
const UNIT_CODES = { C: 'cfs', A: 'acre-feet' };

function decodeUnit(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  return UNIT_CODES[c] || code;
}

// Colorado's official beneficial-use code list (from DWR's own Net Amounts
// data dictionary) — the "use" field returns these codes, not plain words.
const USE_CODES = {
  0: 'Storage', 1: 'Irrigation', 2: 'Municipal', 3: 'Commercial',
  4: 'Industrial', 5: 'Recreation', 6: 'Fishery', 7: 'Fire protection',
  8: 'Domestic', 9: 'Stock watering', A: 'Augmentation',
  B: 'Sub-basin export', C: 'Change of use return flow', E: 'Evaporative',
  F: 'Federal reserved', G: 'Geothermal', H: 'Household use only',
  K: 'Snow making', M: 'Minimum streamflow', P: 'Power generation',
  Q: 'Other', R: 'Recharge', S: 'Export from state',
  T: 'Transmountain export', W: 'Wildlife', X: 'All beneficial uses',
};

function decodeUses(raw) {
  if (!raw) return null;
  return String(raw)
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((code) => USE_CODES[code.toUpperCase()] || code)
    .join(', ');
}

// Amount ranges depend on crop, soil, irrigation method, and how often the
// right is actually in priority — these are ranges, not guarantees.
function explainAmount(amount, unitHint) {
  const n = Number(amount);
  if (!n || n <= 0) return null;
  const unit = (unitHint || '').toLowerCase();

  if (unit.includes('cfs') || (!unit && n < 50)) {
    const lowAcres = Math.round(n * 40);
    const highAcres = Math.round(n * 80);
    return `As a flow rate, this is enough — when the right is in priority — to irrigate roughly ${lowAcres}–${highAcres} acres of hay or pasture. This isn't a guaranteed year-round volume; it's the rate the owner can take when water is available and this right's priority is being honored.`;
  }
  if (unit.includes('af') || unit.includes('acre') || (!unit && n >= 50)) {
    const lowHomes = Math.round(n * 1);
    const highHomes = Math.round(n * 2);
    return `As a stored volume, this could supply roughly ${lowHomes}–${highHomes} single-family households for a year, depending on outdoor/irrigation use.`;
  }
  return null;
}

// How the water is actually delivered changes what it means for a property —
// surface (ditch) rights depend on shared infrastructure and are often owned
// as shares; well rights are pumped on-site but may carry extra legal
// obligations (augmentation) if they're connected to a stream system.
function deliveryNote(structureType) {
  if (!structureType) return null;
  const t = structureType.toLowerCase();
  if (t.includes('well')) {
    return {
      label: 'Well (groundwater)',
      note: 'Delivered by pumping on-site rather than shared infrastructure. If this well is "tributary" to a stream, it may require an augmentation plan — replacing water taken from the aquifer to protect downstream senior rights. Worth confirming before combining this with a physical yield estimate.',
    };
  }
  if (t.includes('ditch') || t.includes('canal')) {
    return {
      label: 'Ditch (surface water)',
      note: "Delivered through shared ditch or canal infrastructure, often owned as shares in a mutual ditch company rather than directly. Reliability depends on both this right's priority date and the ditch company maintaining delivery.",
    };
  }
  if (t.includes('spring')) {
    return { label: 'Spring', note: 'A natural surface discharge point, administered like other surface water rights.' };
  }
  if (t.includes('reservoir') || t.includes('pond')) {
    return { label: 'Reservoir (storage)', note: 'Stored water, typically measured in acre-feet rather than a continuous flow rate.' };
  }
  if (t.includes('pipeline')) {
    return { label: 'Pipeline', note: 'Piped delivery — check the water source above to see whether the underlying right is surface or groundwater.' };
  }
  return { label: structureType, note: null };
}

function seniorityBucket(apropriationDate) {
  if (!apropriationDate) return null;
  const dt = new Date(apropriationDate);
  if (isNaN(dt) || dt.getFullYear() <= 1) return null;
  const year = dt.getFullYear();
  if (year < 1900) {
    return {
      tier: 'senior',
      label: 'Senior right',
      note: 'Established before 1900. Senior rights are served first in a shortage — this is one of the more secure rights on its water source.',
    };
  } else if (year < 1950) {
    return {
      tier: 'moderate',
      label: 'Moderately senior',
      note: 'Established in the early-to-mid 1900s. Reasonably secure, but a meaningful number of older rights on the same source would be served first in a dry year.',
    };
  }
  return {
    tier: 'junior',
    label: 'Junior right',
    note: 'Established after 1950. On a fully appropriated stream, junior rights like this are often the first curtailed in dry years.',
  };
}

function rowLatLon(row) {
  const lat = findVal(row, ['latitude', 'lat', 'locationStructureLatitude', 'wellLatitude']);
  const lon = findVal(row, ['longitude', 'lon', 'lng', 'locationStructureLongitude', 'wellLongitude']);
  if (lat === null || lon === null) return null;
  const latN = Number(lat);
  const lonN = Number(lon);
  if (isNaN(latN) || isNaN(lonN)) return null;
  return { lat: latN, lon: lonN };
}

// Builds the plain-language view of one water right, alongside the raw row
// (see briefing §3.2 — always keep a raw-fields fallback since field-name
// guesses have been wrong before and will be again).
function translateWaterRight(row) {
  const name = findVal(row, ['wrName', 'structureName', 'wr_name']) || 'Unnamed structure';
  const wdid = findVal(row, ['wdid']);
  const structureType = findVal(row, ['structureType', 'structure_type']);
  const apropDate = findVal(row, ['apropriationDate', 'appropriationDate', 'apro_date']);
  const adjDate = findVal(row, ['adjDate', 'adjudicationDate', 'adj_date']);
  const waterSource = findVal(row, ['wdStreamName', 'streamName', 'waterSource', 'wd_stream_name']);
  const division = findVal(row, ['div', 'division', 'wd']);
  const use = findVal(row, ['use', 'useDescr', 'useDescription']);

  const absAmt = findByPattern(row, /abs/i);
  const condAmt = findByPattern(row, /cond/i);
  const unitsInfo = findByPattern(row, /unit/i);
  const decodedUnit = unitsInfo ? decodeUnit(unitsInfo.value) : null;

  const delivery = deliveryNote(structureType);
  const seniority = seniorityBucket(apropDate);
  const confirmedAmount = absAmt && Number(absAmt.value) > 0 ? { value: Number(absAmt.value), unit: decodedUnit } : null;
  const conditionalAmount = condAmt && Number(condAmt.value) > 0 ? { value: Number(condAmt.value), unit: decodedUnit } : null;
  const amountExplainer = confirmedAmount ? explainAmount(confirmedAmount.value, decodedUnit) : null;

  return {
    name,
    wdid,
    structureType,
    delivery,
    waterSource,
    priorityDate: { raw: apropDate, plain: fmtDatePlain(apropDate) },
    adjudicationDate: { raw: adjDate, plain: fmtDatePlain(adjDate) },
    division: division !== null ? { raw: division, label: divisionLabel(division) } : null,
    decreedUse: decodeUses(use),
    confirmedAmount,
    conditionalAmount,
    amountExplainer,
    seniority,
    location: rowLatLon(row),
    raw: row,
  };
}

module.exports = {
  findVal,
  findByPattern,
  fmtDatePlain,
  divisionLabel,
  decodeUnit,
  decodeUses,
  explainAmount,
  deliveryNote,
  seniorityBucket,
  rowLatLon,
  translateWaterRight,
};
