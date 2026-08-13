const { query } = require('../../db');
const { sendInquiryNotification } = require('./notify');

async function createInquiry(listingId, { buyerName, buyerEmail, message }) {
  if (!buyerName || !buyerName.trim()) throw new Error('buyerName is required');
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new Error('a valid buyerEmail is required');
  }
  if (!message || !message.trim()) throw new Error('message is required');

  const { rows: listingRows } = await query('SELECT * FROM listings WHERE id = $1', [listingId]);
  if (listingRows.length === 0) return { notFound: true };
  const listing = listingRows[0];

  const { rows } = await query(
    `INSERT INTO inquiries (listing_id, buyer_name, buyer_email, message)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [listingId, buyerName.trim(), buyerEmail.trim(), message.trim()]
  );
  const inquiry = rows[0];

  // Best-effort — a seller not getting an email notification shouldn't
  // block the inquiry itself from being saved (it's always visible via
  // the listing's manage link either way). See notify.js for what happens
  // when no email provider is configured.
  try {
    await sendInquiryNotification({ listing, inquiry });
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
