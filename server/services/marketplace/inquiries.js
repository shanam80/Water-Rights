const crypto = require('node:crypto');
const { query } = require('../../db');
const { sendInquiryNotification, sendInquiryConfirmation } = require('./notify');

function generateBuyerToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function createInquiry(listingId, { buyerName, buyerEmail, message }) {
  if (!buyerName || !buyerName.trim()) throw new Error('buyerName is required');
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new Error('a valid buyerEmail is required');
  }
  if (!message || !message.trim()) throw new Error('message is required');

  const { rows: listingRows } = await query('SELECT * FROM listings WHERE id = $1', [listingId]);
  if (listingRows.length === 0) return { notFound: true };
  const listing = listingRows[0];

  const buyerToken = generateBuyerToken();
  const { rows } = await query(
    `INSERT INTO inquiries (listing_id, buyer_name, buyer_email, message, buyer_token)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [listingId, buyerName.trim(), buyerEmail.trim(), message.trim(), buyerToken]
  );
  const inquiry = rows[0];

  // Best-effort — a seller/buyer not getting an email notification
  // shouldn't block the inquiry itself from being saved (the seller can
  // always see it via the listing's manage link either way; the buyer's
  // confirmation email is their only way back into the thread, though, so
  // this is the one real gap if email isn't configured). See notify.js
  // for what happens when no email provider is configured.
  try {
    await sendInquiryNotification({ listing, inquiry });
    await sendInquiryConfirmation({ listing, inquiry });
  } catch (err) {
    console.error('Inquiry notification failed (inquiry was still saved):', err.message);
  }

  return {
    inquiry: {
      id: inquiry.id,
      listingId: inquiry.listing_id,
      buyerName: inquiry.buyer_name,
      buyerEmail: inquiry.buyer_email,
      message: inquiry.message,
      buyerToken: inquiry.buyer_token,
      createdAt: inquiry.created_at,
    },
  };
}

async function getInquiriesForListing(listingId, editToken) {
  const { rows: listingRows } = await query('SELECT edit_token FROM listings WHERE id = $1', [listingId]);
  if (listingRows.length === 0) return null;
  if (listingRows[0].edit_token !== editToken) return { forbidden: true };

  const { rows } = await query('SELECT * FROM inquiries WHERE listing_id = $1 ORDER BY created_at DESC', [listingId]);
  return rows.map((r) => ({
    id: r.id,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    message: r.message,
    createdAt: r.created_at,
  }));
}

module.exports = { createInquiry, getInquiriesForListing };
