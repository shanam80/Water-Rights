// Email notification when a buyer sends an inquiry — deliberately optional.
// Without RESEND_API_KEY set, this quietly no-ops (the inquiry itself is
// still saved and visible via the listing's manage link either way) rather
// than failing the whole request. This lets the marketplace work end to
// end without requiring a third external account signup just to try it;
// email becomes a small add-on whenever that's worth doing.
const { sendEmail, isConfigured } = require('../../lib/email');

async function sendInquiryNotification({ listing, inquiry }) {
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping email for inquiry #${inquiry.id} on listing #${listing.id}. The inquiry is still saved.`);
    return { skipped: true };
  }

  const listingUrl = `${process.env.PUBLIC_BASE_URL || ''}/marketplace.html#listing-${listing.id}`;

  return sendEmail({
    to: listing.contact_email,
    replyTo: inquiry.buyer_email,
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
  });
}

module.exports = { sendInquiryNotification, isConfigured };
