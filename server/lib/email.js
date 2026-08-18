// Thin wrapper around Resend's plain HTTP API (https://resend.com) — a
// single POST request, not worth pulling in their SDK for. Shared by
// anything in this project that sends email (marketplace inquiry
// notifications, the general contact form). Deliberately optional
// everywhere it's used: without RESEND_API_KEY set, isConfigured() lets a
// caller skip sending and degrade gracefully instead of failing outright.
const RESEND_API_URL = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, text, replyTo, from, bcc }) {
  const fromAddress = from || process.env.EMAIL_FROM || 'AcreFoot <onboarding@resend.dev>';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(bcc ? { bcc } : {}),
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded with status ${res.status}: ${body}`);
  }

  return { sent: true };
}

module.exports = { sendEmail, isConfigured };
