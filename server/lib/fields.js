// Generic helpers for pulling values out of government API records whose
// exact field names aren't fully trustworthy (undocumented schemas,
// inconsistent casing, renamed fields between endpoints). Shared across
// states because the same problem — and the same fix — shows up in each
// one's raw data.

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

// Matches by normalized key name (letters only, lowercased) instead of an
// exact string — catches a field that's LargePOU in one place and
// Large_POU in another without needing every variant listed out.
function findFuzzy(attrs, targetNormalized) {
  for (const k of Object.keys(attrs)) {
    if (k.replace(/[^a-zA-Z]/g, '').toLowerCase() === targetNormalized) return attrs[k];
  }
  return null;
}

// Government systems often use an obviously-fake far-future or far-past
// date as a "not entered" placeholder rather than leaving the field blank
// (year 9999 is a classic example, confirmed in Idaho's data) — treat
// those as unknown, not real.
function fmtDatePlain(val) {
  if (!val) return null;
  const dt = new Date(val);
  if (isNaN(dt)) return null;
  const year = dt.getFullYear();
  if (year <= 1 || year >= 9000) return null;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = { findVal, findByPattern, findFuzzy, fmtDatePlain };
