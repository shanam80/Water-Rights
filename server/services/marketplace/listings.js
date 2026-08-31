// Listings have no owning user account — instead, creating one returns a
// random edit_token (shown to the seller exactly once, like a private
// "manage this listing" link) that's required for any later edit/delete.
// Simpler than building real accounts for v1, at the cost of "lose the
// link, lose access" — an acceptable tradeoff for a first version.
const crypto = require('node:crypto');
const { query } = require('../../db');
const { enrichListing } = require('./enrichment');

const VALID_STATES = ['CO', 'ID', 'UT', 'MT', 'NV', 'TX', 'WY'];
const VALID_STATUSES = ['active', 'sold', 'removed'];

function generateEditToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function toPublicListing(row) {
  // contact_email and edit_token are deliberately left out of the public
  // shape — email only reaches the seller via an inquiry (see
  // inquiries.js), and the edit token is only ever returned once, at
  // creation, or echoed back to whoever already proved they hold it.
  return {
    id: row.id,
    state: row.state,
    rightIdentifier: row.right_identifier,
    rightType: row.right_type,
    title: row.title,
    description: row.description,
    county: row.county,
    askingPriceUsd: row.asking_price_usd !== null ? Number(row.asking_price_usd) : null,
    priceNote: row.price_note,
    contactName: row.contact_name,
    status: row.status,
    // Snapshot from server/services/marketplace/enrichment.js — real
    // government data cross-checked against this listing's claimed right,
    // not just the seller's own free-text entry. Public on purpose: this
    // is what makes a listing trustworthy to a buyer.
    verifiedData: row.verified_data,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOwnerListing(row) {
  return { ...toPublicListing(row), contactEmail: row.contact_email };
}

async function createListing(input) {
  const { state, rightIdentifier, rightType, title, description, county, askingPriceUsd, priceNote, contactName, contactEmail } = input;

  if (!VALID_STATES.includes(state)) {
    throw new Error(`state must be one of: ${VALID_STATES.join(', ')}`);
  }
  if (!title || !title.trim()) throw new Error('title is required');
  if (!contactName || !contactName.trim()) throw new Error('contactName is required');
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new Error('a valid contactEmail is required');
  }
  if (askingPriceUsd !== undefined && askingPriceUsd !== null && Number(askingPriceUsd) < 0) {
    throw new Error('askingPriceUsd cannot be negative');
  }

  const editToken = generateEditToken();
  const { rows } = await query(
    `INSERT INTO listings
      (state, right_identifier, right_type, title, description, county, asking_price_usd, price_note, contact_name, contact_email, edit_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [state, rightIdentifier || null, rightType || null, title.trim(), description || null, county || null, askingPriceUsd ?? null, priceNote || null, contactName.trim(), contactEmail.trim(), editToken]
  );
  let listingRow = rows[0];

  // Best-effort — a slow/unreachable state API shouldn't block a listing
  // from being created (same graceful-degradation pattern as email
  // notifications elsewhere in this file).
  if (rightIdentifier && rightIdentifier.trim()) {
    try {
      const verifiedData = await enrichListing(state, rightIdentifier);
      if (verifiedData) {
        const { rows: updated } = await query(
          `UPDATE listings SET verified_data = $1, verified_at = now() WHERE id = $2 RETURNING *`,
          [JSON.stringify(verifiedData), listingRow.id]
        );
        listingRow = updated[0];
      }
    } catch (err) {
      console.error(`Listing enrichment failed for new listing #${listingRow.id} (listing was still created):`, err.message);
    }
  }

  return { listing: toOwnerListing(listingRow), editToken };
}

// Browse/search. Only "active" listings are shown by default — a buyer
// browsing shouldn't see removed or already-sold listings unless they
// explicitly ask (status=all), e.g. for a "recently sold" view later.
async function listListings({ state, status, minPrice, maxPrice } = {}) {
  const conditions = [];
  const params = [];

  if (state) {
    if (!VALID_STATES.includes(state)) throw new Error(`state must be one of: ${VALID_STATES.join(', ')}`);
    params.push(state);
    conditions.push(`state = $${params.length}`);
  }
  if (status && status !== 'all') {
    if (!VALID_STATUSES.includes(status)) throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}, all`);
    params.push(status);
    conditions.push(`status = $${params.length}`);
  } else if (!status) {
    conditions.push(`status = 'active'`);
  }
  if (minPrice !== undefined && minPrice !== null) {
    params.push(minPrice);
    conditions.push(`asking_price_usd >= $${params.length}`);
  }
  if (maxPrice !== undefined && maxPrice !== null) {
    params.push(maxPrice);
    conditions.push(`asking_price_usd <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM listings ${where} ORDER BY created_at DESC LIMIT 200`, params);
  return rows.map(toPublicListing);
}

async function getListing(id) {
  const { rows } = await query('SELECT * FROM listings WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return toPublicListing(rows[0]);
}

async function getListingForOwner(id, editToken) {
  const { rows } = await query('SELECT * FROM listings WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  if (rows[0].edit_token !== editToken) return { forbidden: true };
  return toOwnerListing(rows[0]);
}

async function updateListing(id, editToken, updates) {
  const { rows: existingRows } = await query('SELECT * FROM listings WHERE id = $1', [id]);
  if (existingRows.length === 0) return null;
  if (existingRows[0].edit_token !== editToken) return { forbidden: true };

  const allowed = ['title', 'description', 'county', 'askingPriceUsd', 'priceNote', 'contactName', 'contactEmail', 'status', 'rightIdentifier', 'rightType'];
  const columnFor = {
    title: 'title', description: 'description', county: 'county', askingPriceUsd: 'asking_price_usd',
    priceNote: 'price_note', contactName: 'contact_name', contactEmail: 'contact_email', status: 'status',
    rightIdentifier: 'right_identifier', rightType: 'right_type',
  };

  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (!(key in updates)) continue;
    if (key === 'status' && !VALID_STATUSES.includes(updates.status)) {
      throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    params.push(updates[key]);
    sets.push(`${columnFor[key]} = $${params.length}`);
  }
  if (sets.length === 0) return toOwnerListing(existingRows[0]);

  sets.push(`updated_at = now()`);
  params.push(id);
  const { rows } = await query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  let listingRow = rows[0];

  // Re-verify if the claimed right_identifier actually changed — the old
  // snapshot would otherwise describe a different right than what's shown.
  const identifierChanged = 'rightIdentifier' in updates && updates.rightIdentifier !== existingRows[0].right_identifier;
  if (identifierChanged) {
    try {
      const verifiedData = listingRow.right_identifier ? await enrichListing(listingRow.state, listingRow.right_identifier) : null;
      const { rows: updated } = await query(
        `UPDATE listings SET verified_data = $1, verified_at = $2 WHERE id = $3 RETURNING *`,
        [verifiedData ? JSON.stringify(verifiedData) : null, verifiedData ? new Date() : null, id]
      );
      listingRow = updated[0];
    } catch (err) {
      console.error(`Listing re-enrichment failed for listing #${id} (update was still saved):`, err.message);
    }
  }

  return toOwnerListing(listingRow);
}

module.exports = { createListing, listListings, getListing, getListingForOwner, updateListing };
