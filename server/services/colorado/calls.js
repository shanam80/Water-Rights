// Colorado administrative calls — real curtailment data, not a proxy.
//
// How Colorado's priority system actually works: when a senior right isn't
// getting its water, it "places a call" on the stream. Everything JUNIOR to
// the calling priority must then stop diverting. Seniority is expressed as
// an administration number, where LOWER = more senior — confirmed directly
// from the live data (admin 4899 = 1863, 6148 = 1866, 22428 = 1911).
//
// Both halves needed for this were confirmed live 2026-08-31:
//   - /administrativecalls/active/    — calls currently in effect
//     (154 statewide, filterable by division, so this is a small fetch)
//   - /waterrights/netamount/          — already used elsewhere in this
//     project, and carries `adminNumber` for the right itself
// so "is this right currently curtailed" is directly computable rather
// than estimated from a priority date alone.
//
// Deliberate limitation, stated rather than papered over: calls are matched
// to rights by exact water-source name. Colorado stream administration has
// real tributary nuance a name match doesn't capture, so a call on a
// mainstem may affect tributary rights this won't flag. The UI presents
// this as "what the state's own call records show for this source," never
// as a legal determination.
const { fetchWithTimeout } = require('../../lib/http');
const { TtlCache } = require('../../lib/cache');

const ACTIVE_URL = 'https://dwr.state.co.us/Rest/GET/api/v2/administrativecalls/active/';
const HISTORICAL_URL = 'https://dwr.state.co.us/Rest/GET/api/v2/administrativecalls/historical/';

// Active calls change over a season, not minute to minute. History changes
// even less, and a whole division's worth comes back in one request
// (confirmed: 2,983 records for Division 1 since 2021 in a single page).
const ACTIVE_TTL_MS = 15 * 60 * 1000;
const HISTORICAL_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_SINCE_YEAR = 2021;

const cache = new TtlCache();

function normalizeSource(name) {
  return String(name || '').trim().toUpperCase();
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Colorado DWR calls API responded with status ${res.status}`);
  const data = await res.json();
  return data.ResultList || [];
}

async function getActiveCalls(division) {
  const key = `active:${division}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const rows = await fetchJson(`${ACTIVE_URL}?format=json&division=${encodeURIComponent(division)}&pageSize=1000`);
  cache.set(key, rows, ACTIVE_TTL_MS);
  return rows;
}

// Counts of past calls per water source, used as a "how often does this
// source actually get called" risk signal — distinct from whether it's
// under call right now.
async function getHistoricalCallCounts(division) {
  const key = `historical:${division}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const rows = await fetchJson(
    `${HISTORICAL_URL}?format=json&division=${encodeURIComponent(division)}` +
      `&min-dateTimeSet=01%2F01%2F${HISTORY_SINCE_YEAR}&pageSize=50000`
  );
  const counts = new Map();
  for (const row of rows) {
    const src = normalizeSource(row.waterSourceName);
    if (src) counts.set(src, (counts.get(src) || 0) + 1);
  }
  cache.set(key, counts, HISTORICAL_TTL_MS);
  return counts;
}

// Returns null when there isn't enough to say anything real — a right with
// no admin number or no division can't be assessed, and saying nothing is
// better than implying a status we can't support.
async function assessCurtailment({ division, waterSource, adminNumber }) {
  const div = Number(division);
  const admin = Number(adminNumber);
  const source = normalizeSource(waterSource);
  if (!div || !source || Number.isNaN(admin) || admin <= 0) return null;

  const [activeCalls, historicalCounts] = await Promise.all([
    getActiveCalls(div),
    getHistoricalCallCounts(div).catch(() => new Map()), // risk context is optional; status is the point
  ]);

  const onThisSource = activeCalls.filter((c) => normalizeSource(c.waterSourceName) === source);

  // The binding constraint is the most senior active call (lowest admin
  // number) — anything junior to it has to stop diverting.
  let controllingCall = null;
  for (const call of onThisSource) {
    const callAdmin = Number(call.priorityAdminNumber);
    if (Number.isNaN(callAdmin)) continue;
    if (!controllingCall || callAdmin < Number(controllingCall.priorityAdminNumber)) controllingCall = call;
  }

  const historicalCallCount = historicalCounts.get(source) || 0;

  if (!controllingCall) {
    return {
      status: 'no-active-call',
      waterSource,
      adminNumber: admin,
      historicalCallCount,
      historicalSinceYear: HISTORY_SINCE_YEAR,
    };
  }

  const callAdmin = Number(controllingCall.priorityAdminNumber);
  const isJunior = admin > callAdmin;

  return {
    status: isJunior ? 'out-of-priority' : 'in-priority',
    waterSource,
    adminNumber: admin,
    historicalCallCount,
    historicalSinceYear: HISTORY_SINCE_YEAR,
    call: {
      callingStructure: controllingCall.priorityStructureName || controllingCall.locationStructureName,
      priorityAdminNumber: callAdmin,
      priorityDate: controllingCall.priorityDate,
      dateTimeSet: controllingCall.dateTimeSet,
      moreInformationUrl: controllingCall.moreInformation,
    },
  };
}

// Enriches a list of translated rights in place. Pre-warms the per-division
// caches first so a page of 20 rights doesn't fire 20 concurrent identical
// fetches on a cold cache. Best-effort throughout: if DWR's calls API is
// down, rights still come back, just without curtailment info — the search
// itself should never fail because this add-on did.
async function attachCurtailment(rights) {
  const divisions = [...new Set(rights.map((r) => Number(r.division?.raw)).filter((d) => d && !Number.isNaN(d)))];
  if (divisions.length === 0) return rights;

  await Promise.all(
    divisions.map((div) =>
      Promise.all([getActiveCalls(div).catch(() => []), getHistoricalCallCounts(div).catch(() => new Map())])
    )
  );

  for (const right of rights) {
    try {
      right.curtailment = await assessCurtailment({
        division: right.division?.raw,
        waterSource: right.waterSource,
        adminNumber: right.adminNumber,
      });
    } catch {
      right.curtailment = null;
    }
  }
  return rights;
}

module.exports = { assessCurtailment, attachCurtailment, getActiveCalls, getHistoricalCallCounts };
