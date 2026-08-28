// Saved point searches with change alerts — no accounts, matching the
// no-login pattern used everywhere else in this project. CO/ID/UT only
// (see schema.sql), reusing the same point-search functions the state
// pages themselves call, not a separate data path.
//
// The change-detection is deliberately simple: capture the set of stable
// identifiers (wdid/wrNumber) found near a point at save-time, and on each
// check, diff that against a fresh search. New identifiers = alert. This
// doesn't try to detect edits to an existing right (a status change, a
// priority date correction) — only new rights appearing nearby. Cheap,
// honest, and matches what a landowner mainly cares about ("did anyone
// file something new near my property"), not a full change-history system.
const crypto = require('node:crypto');
const { query } = require('../db');
const { sendEmail, isConfigured } = require('../lib/email');
const { searchWaterRightsNearPoint } = require('./colorado/waterRights');
const { searchWaterRightsAtPoint } = require('./idaho/waterRights');
const { findNearbyWaterRights } = require('./utah/waterRights');

const VALID_STATES = ['CO', 'ID', 'UT'];
const STATE_LABELS = { CO: 'Colorado', ID: 'Idaho', UT: 'Utah' };

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Normalizes each state's differently-shaped search result down to just
// the stable identifiers present, plus enough to describe a new one in an
// alert email.
async function runPointSearch(state, { lat, lon, county }) {
  if (state === 'CO') {
    if (!county) throw new Error('county is required for a Colorado saved search');
    const { onParcelRights, nearbyRights } = await searchWaterRightsNearPoint(county, lat, lon);
    const all = [...onParcelRights, ...nearbyRights];
    return all.filter((r) => r.wdid).map((r) => ({ id: r.wdid, name: r.name }));
  }
  if (state === 'ID') {
    const { rights } = await searchWaterRightsAtPoint(lat, lon);
    return rights.filter((r) => r.wrNumber).map((r) => ({ id: r.wrNumber, name: r.name }));
  }
  if (state === 'UT') {
    const { rights } = await findNearbyWaterRights(lat, lon);
    return rights.filter((r) => r.wrNumber).map((r) => ({ id: r.wrNumber, name: r.owner || `Water right ${r.wrNumber}` }));
  }
  throw new Error(`Saved searches aren't supported for state: ${state}`);
}

async function createSavedSearch({ email, state, lat, lon, county, label }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('a valid email is required');
  if (!VALID_STATES.includes(state)) throw new Error(`state must be one of: ${VALID_STATES.join(', ')}`);
  const latN = Number(lat);
  const lonN = Number(lon);
  if (Number.isNaN(latN) || Number.isNaN(lonN)) throw new Error('lat and lon are required');

  const found = await runPointSearch(state, { lat: latN, lon: lonN, county });
  const knownIds = found.map((r) => r.id);

  const unsubscribeToken = generateToken();
  const { rows } = await query(
    `INSERT INTO saved_searches (email, state, lat, lon, county, label, known_right_ids, unsubscribe_token, last_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
    [email.trim(), state, latN, lonN, county || null, label || null, JSON.stringify(knownIds), unsubscribeToken]
  );
  const saved = rows[0];
  return {
    id: saved.id,
    email: saved.email,
    state: saved.state,
    label: saved.label,
    knownRightCount: knownIds.length,
    unsubscribeToken,
  };
}

async function deleteSavedSearch(unsubscribeToken) {
  const { rowCount } = await query('DELETE FROM saved_searches WHERE unsubscribe_token = $1', [unsubscribeToken]);
  return rowCount > 0;
}

async function sendNewRightsAlert(savedSearch, newRights) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping alert email for saved search #${savedSearch.id}.`);
    return { skipped: true };
  }
  const label = savedSearch.label || `${savedSearch.lat.toFixed(4)}, ${savedSearch.lon.toFixed(4)}`;
  const unsubscribeUrl = `${process.env.PUBLIC_BASE_URL || ''}/api/saved-searches/${encodeURIComponent(savedSearch.unsubscribe_token)}`;
  return sendEmail({
    to: savedSearch.email,
    subject: `New ${STATE_LABELS[savedSearch.state]} water right(s) near ${label}`,
    text: [
      `AcreFoot found ${newRights.length} new water right(s) on file near your saved search (${label}):`,
      '',
      ...newRights.map((r) => `- ${r.name || 'Unnamed'} (${r.id})`),
      '',
      `See the full current list: ${process.env.PUBLIC_BASE_URL || ''}/${savedSearch.state === 'CO' ? '' : savedSearch.state.toLowerCase() + '.html'}`,
      '',
      `To stop these alerts, delete this saved search: ${unsubscribeUrl} (DELETE request — open it via curl or the site if it's ever exposed there)`,
    ].join('\n'),
  });
}

// Re-runs the point search for one saved search, diffs against what was
// known last time, alerts on anything new, and updates the snapshot either
// way (so a right that comes and goes doesn't re-trigger every check).
async function checkSavedSearch(row) {
  const found = await runPointSearch(row.state, { lat: row.lat, lon: row.lon, county: row.county });
  const knownIds = new Set(row.known_right_ids || []);
  const newRights = found.filter((r) => !knownIds.has(r.id));

  if (newRights.length > 0) {
    try {
      await sendNewRightsAlert(row, newRights);
    } catch (err) {
      console.error(`Alert email failed for saved search #${row.id} (snapshot still updated):`, err.message);
    }
  }

  await query('UPDATE saved_searches SET known_right_ids = $1, last_checked_at = now() WHERE id = $2', [
    JSON.stringify(found.map((r) => r.id)),
    row.id,
  ]);

  return { checked: row.id, newCount: newRights.length };
}

async function checkAllSavedSearches() {
  const { rows } = await query('SELECT * FROM saved_searches');
  const results = [];
  for (const row of rows) {
    try {
      results.push(await checkSavedSearch(row));
    } catch (err) {
      console.error(`Checking saved search #${row.id} failed:`, err.message);
      results.push({ checked: row.id, error: err.message });
    }
    // Brief pacing gap so a large batch doesn't hammer three government
    // APIs back-to-back — matches the pacing already used in the Texas
    // GCD batch-extraction scripts.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return results;
}

module.exports = { createSavedSearch, deleteSavedSearch, checkAllSavedSearches, checkSavedSearch, runPointSearch };
