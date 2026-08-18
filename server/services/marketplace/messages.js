// The actual in-platform conversation for an inquiry — replies from either
// side, after the buyer's opening message (which stays on inquiries.message,
// not duplicated here). A single token authenticates whoever's asking:
// the inquiry's own buyer_token identifies the buyer, the listing's
// edit_token (which the seller already has, to manage the listing itself)
// identifies the seller. No separate seller login/token needed.
const { query } = require('../../db');
const { sendMessageNotification } = require('./notify');

async function resolveSender(inquiryId, token) {
  const { rows } = await query(
    `SELECT i.buyer_token, l.edit_token
     FROM inquiries i JOIN listings l ON l.id = i.listing_id
     WHERE i.id = $1`,
    [inquiryId]
  );
  if (rows.length === 0) return null;
  if (token && rows[0].buyer_token === token) return 'buyer';
  if (token && rows[0].edit_token === token) return 'seller';
  return null;
}

async function getThread(inquiryId, token) {
  const sender = await resolveSender(inquiryId, token);
  if (!sender) return { forbidden: true };

  const { rows: inquiryRows } = await query(
    `SELECT i.*, l.title AS listing_title, l.id AS listing_id, l.status AS listing_status
     FROM inquiries i JOIN listings l ON l.id = i.listing_id
     WHERE i.id = $1`,
    [inquiryId]
  );
  if (inquiryRows.length === 0) return { forbidden: true };
  const inquiry = inquiryRows[0];

  const { rows: messageRows } = await query('SELECT * FROM messages WHERE inquiry_id = $1 ORDER BY created_at ASC', [inquiryId]);

  const messages = [
    { sender: 'buyer', body: inquiry.message, createdAt: inquiry.created_at },
    ...messageRows.map((m) => ({ sender: m.sender, body: m.body, createdAt: m.created_at })),
  ];

  return {
    viewingAs: sender,
    listingId: inquiry.listing_id,
    listingTitle: inquiry.listing_title,
    listingStatus: inquiry.listing_status,
    buyerName: inquiry.buyer_name,
    messages,
  };
}

async function postMessage(inquiryId, token, body) {
  if (!body || !body.trim()) throw new Error('message is required');

  const sender = await resolveSender(inquiryId, token);
  if (!sender) return { forbidden: true };

  const { rows } = await query('INSERT INTO messages (inquiry_id, sender, body) VALUES ($1, $2, $3) RETURNING *', [
    inquiryId,
    sender,
    body.trim(),
  ]);
  const message = rows[0];

  const { rows: ctxRows } = await query(
    `SELECT i.id, i.buyer_name, i.buyer_email, i.buyer_token, l.id AS listing_id, l.title AS listing_title, l.contact_email AS seller_email, l.edit_token
     FROM inquiries i JOIN listings l ON l.id = i.listing_id WHERE i.id = $1`,
    [inquiryId]
  );
  const inquiryContext = ctxRows[0];

  // Best-effort — a notification failing shouldn't undo an already-saved
  // message; the recipient will still see it next time they open the thread.
  try {
    await sendMessageNotification({ sender, message, inquiry: inquiryContext });
  } catch (err) {
    console.error('Message notification failed (message was still saved):', err.message);
  }

  return { message: { id: message.id, sender: message.sender, body: message.body, createdAt: message.created_at } };
}

module.exports = { getThread, postMessage };
