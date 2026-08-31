// Decoders for Nevada's short codes. NDWR's ArcGIS service exposes no
// coded-value domains (checked live 2026-08-28 — every field's `domain` is
// null), which is why an earlier pass passed these through raw. Both maps
// below were built from real evidence, not inference:
//
// COUNTY: verified live by sampling ~9 records spread across each code and
// reverse-geocoding their real coordinates against the US Census county
// layer, then taking the majority. A single sample per code was tried first
// and proved unreliable (border records and bad coordinates landed in
// neighboring counties), so majority-vote across a spread sample is what
// these are based on. 18 of 19 came back with a clear ≥8/9 majority.
// Notable: AL is Alpine County, CALIFORNIA — not a Nevada county at all
// (Tahoe-basin interstate records). A "Nevada counties only" assumption
// would have gotten that one wrong.
//
// STATUS: NOT guessed. 14 of 24 codes come from NDWR's own published
// descriptions of its water-right application statuses. The remaining 10
// (ABR, DEN, REJ, REL, RET, RSC, RVK, SUP, SUS, WDR) could not be confirmed
// from an authoritative source and are deliberately left undecoded — water
// right status has real legal meaning, and a plausible-but-wrong expansion
// ("Denied" vs. something else) would be worse than showing the raw code.
// See the project's standing rule: never ship an unverified translation.

const COUNTY_CODES = {
  AL: 'Alpine County, California',
  CC: 'Carson City',
  CH: 'Churchill County',
  CL: 'Clark County',
  DO: 'Douglas County',
  EL: 'Elko County',
  ES: 'Esmeralda County',
  EU: 'Eureka County',
  HU: 'Humboldt County',
  LA: 'Lander County',
  LI: 'Lincoln County',
  LY: 'Lyon County',
  MI: 'Mineral County',
  NY: 'Nye County',
  PE: 'Pershing County',
  ST: 'Storey County',
  WA: 'Washoe County',
  WP: 'White Pine County',
  // UK appears on only 7 records statewide, and their coordinates scatter
  // across three different states — consistent with an "unknown/unspecified"
  // placeholder rather than a real jurisdiction. Labeled as such rather than
  // assigned a county.
  UK: 'Unknown / unspecified',
};

// label: what the code stands for.
// inactive: true only where NDWR explicitly describes the status as inactive.
// Absence of `inactive` means "not established either way," not "active."
const STATUS_CODES = {
  APP: { label: 'Application' },
  PER: { label: 'Permit' },
  CER: { label: 'Certificate' },
  DEC: { label: 'Decreed' },
  VST: { label: 'Vested right' },
  RES: { label: 'Reserved' },
  RFA: { label: 'Ready for action' },
  RFP: { label: 'Ready for action — protested' },
  RVP: { label: 'Revocable permit' },
  RLP: { label: 'Relinquished portion' },
  ABN: { label: 'Abandoned', inactive: true },
  CAN: { label: 'Cancelled', inactive: true },
  EXP: { label: 'Expired', inactive: true },
  FOR: { label: 'Forfeited', inactive: true },
};

function decodeCounty(code) {
  if (!code) return null;
  const key = String(code).trim().toUpperCase();
  return { code: key, label: COUNTY_CODES[key] || null };
}

function decodeStatus(code) {
  if (!code) return null;
  const key = String(code).trim().toUpperCase();
  const known = STATUS_CODES[key];
  if (!known) return { code: key, label: null, inactive: null };
  return { code: key, label: known.label, inactive: known.inactive ?? null };
}

module.exports = { decodeCounty, decodeStatus, COUNTY_CODES, STATUS_CODES };
