// Listings have no owning user account — instead, creating one returns a
// random edit_token (shown to the seller exactly once, like a private
// "manage this listing" link) that's required for any later edit/delete.
// Simpler than building real accounts for v1, at the cost of "lose the
// link, lose access" — an acceptable tradeoff for a first version.
const crypto = require('node:crypto');
const { query } = require('../../db');

const VALID_STATES = ['CO', 'ID', 'UT'];
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

  return { listing: toOwnerListing(rows[0]), editToken };
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
  return toOwnerListing(rows[0]);
}

module.exports = { createListing, listListings, getListing, getListingForOwner, updateListing };
