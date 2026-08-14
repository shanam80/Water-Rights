// General site contact — not tied to a specific marketplace listing.
// Someone who just finds the site and has a question. Always saved to the
// database regardless of whether the email notification succeeds (same
// graceful-degradation pattern as marketplace inquiries); the destination
// address is deliberately an env var (ADMIN_EMAIL), never hardcoded, and
// never shown to the person filling out the form.
const { query } = require('../db');
const { sendEmail, isConfigured } = require('../lib/email');

async function createContactMessage({ name, email, message }) {
  if (!name || !name.trim()) throw new Error('name is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('a valid email is required');
  }
  if (!message || !message.trim()) throw new Error('message is required');

  const { rows } = await query(
    `INSERT INTO contact_messages (name, email, message) VALUES ($1, $2, $3) RETURNING *`,
    [name.trim(), email.trim(), message.trim()]
  );
  const saved = rows[0];

  try {
    await sendAdminNotification(saved);
  } catch (err) {
    console.error('Contact notification failed (message was still saved):', err.message);
  }

  return {
    id: saved.id,
    name: saved.name,
    email: saved.email,
    message: saved.message,
    createdAt: saved.created_at,
  };
}

async function sendAdminNotification(contactMessage) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[notify] ADMIN_EMAIL not set — skipping email for contact message #${contactMessage.id}. The message is still saved.`);
    return { skipped: true };
  }
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping email for contact message #${contactMessage.id}. The message is still saved.`);
    return { skipped: true };
  }

  return sendEmail({
    to: adminEmail,
    replyTo: contactMessage.email,
    subject: `New site contact message from ${contactMessage.name}`,
    text: [
      `${contactMessage.name} (${contactMessage.email}) sent a message through the site contact form:`,
      '',
      contactMessage.message,
      '',
      'Reply directly to this email to respond to them.',
    ].join('\n'),
  });
}

module.exports = { createContactMessage };
