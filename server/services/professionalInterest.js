// Interest signups for a possible future paid professional tier — see
// docs/project-briefing.md and the business-model-strategy memory. This is
// deliberately just an email capture, not a real product: no accounts, no
// billing, nothing gated. The point is to see whether real demand exists
// before building any of that. Same graceful-degradation pattern as
// contact.js — always saved regardless of whether the email notification
// succeeds.
const { query } = require('../db');
const { sendEmail, isConfigured } = require('../lib/email');

async function createProfessionalInterest({ email, role, context }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('a valid email is required');
  }

  const { rows } = await query(
    `INSERT INTO professional_interest (email, role, context) VALUES ($1, $2, $3) RETURNING *`,
    [email.trim(), role?.trim() || null, context?.trim() || null]
  );
  const saved = rows[0];

  try {
    await sendAdminNotification(saved);
  } catch (err) {
    console.error('Professional-interest notification failed (signup was still saved):', err.message);
  }

  return {
    id: saved.id,
    email: saved.email,
    role: saved.role,
    context: saved.context,
    createdAt: saved.created_at,
  };
}

async function sendAdminNotification(signup) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[notify] ADMIN_EMAIL not set — skipping email for professional-interest signup #${signup.id}. The signup is still saved.`);
    return { skipped: true };
  }
  if (!isConfigured()) {
    console.log(`[notify] RESEND_API_KEY not set — skipping email for professional-interest signup #${signup.id}. The signup is still saved.`);
    return { skipped: true };
  }

  return sendEmail({
    to: adminEmail,
    replyTo: signup.email,
    subject: `New professional-tier interest signup: ${signup.email}`,
    text: [
      `${signup.email} signed up for professional-tier updates.`,
      '',
      signup.role ? `Role: ${signup.role}` : null,
      signup.context ? `What they'd use it for: ${signup.context}` : null,
    ].filter(Boolean).join('\n'),
  });
}

module.exports = { createProfessionalInterest };
