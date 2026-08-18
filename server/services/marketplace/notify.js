// Email notifications for the marketplace's in-platform messaging.
// Deliberately optional throughout — without RESEND_API_KEY set, every
// function here quietly no-ops (messages are still saved and visible via
// the relevant in-platform link either way) rather than failing the
// request. ADMIN_EMAIL, if set, is BCC'd on every notification below so
// the platform owner sees marketplace activity as it happens — the
// previously-deferred piece of this feature.
const { sendEmail, isConfigured } = require('../../lib/email');

function adminBcc() {
  return process.env.ADMIN_EMAIL || undefined;
}

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || '';
}

// Sent to the seller when a buyer first contacts them. No "reply to this
// email" instruction — replying happens on the site now (manage link),
// not by hijacking this notification as the actual conversation channel.
async function sendInquiryNotification({ listing, inquiry }) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping seller email for inquiry #${inquiry.id} on listing #${listing.id}. The inquiry is still saved.`);
    return { skipped: true };
  }

  const manageUrl = `${baseUrl()}/marketplace.html?manage=${listing.id}&token=${listing.edit_token}`;

  return sendEmail({
    to: listing.contact_email,
    bcc: adminBcc(),
    subject: `New inquiry about "${listing.title}"`,
    text: [
      `${inquiry.buyer_name} (${inquiry.buyer_email}) sent an inquiry about your listing "${listing.title}":`,
      '',
      inquiry.message,
      '',
      `Reply on AcreFoot (not by replying to this email): ${manageUrl}`,
    ].join('\n'),
  });
}

// Sent to the buyer right after they send an inquiry — their only way back
// into the conversation, since there's no login. Mirrors how a seller's
// edit_token link already works for listings.
async function sendInquiryConfirmation({ listing, inquiry }) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping buyer confirmation for inquiry #${inquiry.id}.`);
    return { skipped: true };
  }

  const threadUrl = `${baseUrl()}/marketplace.html?thread=${inquiry.id}&token=${inquiry.buyer_token}`;

  return sendEmail({
    to: inquiry.buyer_email,
    bcc: adminBcc(),
    subject: `Your inquiry about "${listing.title}"`,
    text: [
      `Your message to the seller of "${listing.title}" was sent.`,
      '',
      `View or continue this conversation any time: ${threadUrl}`,
      '',
      `Save this link — it's the only way back into this conversation, since there's no account/login for buyers.`,
    ].join('\n'),
  });
}

// Sent whenever either side posts a reply. Only a preview of the message,
// not the full text — the actual conversation lives on the site, not in
// an email thread that could quietly become the real off-platform channel.
async function sendMessageNotification({ sender, message, inquiry }) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping reply notification for inquiry #${inquiry.id}.`);
    return { skipped: true };
  }

  const preview = message.body.length > 150 ? `${message.body.slice(0, 150)}…` : message.body;

  if (sender === 'seller') {
    const threadUrl = `${baseUrl()}/marketplace.html?thread=${inquiry.id}&token=${inquiry.buyer_token}`;
    return sendEmail({
      to: inquiry.buyer_email,
      bcc: adminBcc(),
      subject: `New reply about "${inquiry.listing_title}"`,
      text: [`The seller replied to your conversation about "${inquiry.listing_title}":`, '', preview, '', `View and reply: ${threadUrl}`].join('\n'),
    });
  }

  const manageUrl = `${baseUrl()}/marketplace.html?manage=${inquiry.listing_id}&token=${inquiry.edit_token}`;
  return sendEmail({
    to: inquiry.seller_email,
    bcc: adminBcc(),
    subject: `New reply about "${inquiry.listing_title}"`,
    text: [`${inquiry.buyer_name} replied to their inquiry about "${inquiry.listing_title}":`, '', preview, '', `View and reply: ${manageUrl}`].join('\n'),
  });
}

module.exports = { sendInquiryNotification, sendInquiryConfirmation, sendMessageNotification, isConfigured };
