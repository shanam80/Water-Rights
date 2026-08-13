// Email notification when a buyer sends an inquiry — deliberately optional.
// Without RESEND_API_KEY set, this quietly no-ops (the inquiry itself is
// still saved and visible via the listing's manage link either way) rather
// than failing the whole request. This lets the marketplace work end to
// end without requiring a third external account signup just to try it;
// email becomes a small add-on whenever that's worth doing.
//
// Uses Resend's plain HTTP API directly (https://resend.com) instead of
// pulling in their SDK — it's a single POST request, not worth a
// dependency for.
const RESEND_API_URL = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendInquiryNotification({ listing, inquiry }) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping email for inquiry #${inquiry.id} on listing #${listing.id}. The inquiry is still saved.`);
    return { skipped: true };
  }

  const fromAddress = process.env.EMAIL_FROM || 'Western Water Rights <onboarding@resend.dev>';
  const listingUrl = `${process.env.PUBLIC_BASE_URL || ''}/marketplace.html#listing-${listing.id}`;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: listing.contact_email,
      reply_to: inquiry.buyer_email,
      subject: `New inquiry about "${listing.title}"`,
      text: [
        `${inquiry.buyer_name} (${inquiry.buyer_email}) sent an inquiry about your listing "${listing.title}":`,
        '',
        inquiry.message,
        '',
        `View your listing: ${listingUrl}`,
        '',
        `Reply directly to this email to respond to ${inquiry.buyer_name}.`,
      ].join('\n'),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded with status ${res.status}: ${body}`);
  }

  return { sent: true };
}

module.exports = { sendInquiryNotification, isConfigured };
