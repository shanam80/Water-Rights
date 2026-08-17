// Thin wrapper around the Claude Messages API, used only by the offline GCD
// restriction-extraction script (server/scripts/extractGcdRestrictions.js) —
// nothing on the live request path calls this. Reads a management-plan PDF
// directly (Claude renders PDF pages itself, including scanned/image-only
// pages, so no separate OCR step is needed here).
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Shared by both extraction paths below. Returns the raw text of Claude's
// reply (the caller is responsible for parsing it as JSON, since asking the
// model to reply JSON-only is a prompt instruction, not a hard guarantee).
// A large scanned document can genuinely take a couple of minutes to process
// (it's real vision work over 50-150+ page images), so this needs a much
// longer timeout than the 15s default used for the live API's outbound
// government-data calls.
async function callMessages(content, { maxTokens = 4096, timeoutMs = 240000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Claude API call timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API responded with status ${res.status}: ${body}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock) throw new Error('Claude API response had no text content block.');
  return textBlock.text;
}

// pdfBase64: base64-encoded PDF bytes. Claude renders the pages itself,
// including scanned/image-only ones, so no separate OCR step is needed here.
async function extractFromPdf({ pdfBase64, prompt, maxTokens, timeoutMs }) {
  return callMessages(
    [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: prompt },
    ],
    { maxTokens, timeoutMs }
  );
}

// documentText: already-extracted plain text (e.g. from a .docx via
// mammoth) — for source documents the API's PDF/vision path doesn't apply
// to. Claude only sees the text, not the original layout/formatting.
async function extractFromText({ documentText, prompt, maxTokens, timeoutMs }) {
  return callMessages([{ type: 'text', text: `${prompt}\n\n---DOCUMENT TEXT---\n${documentText}` }], { maxTokens, timeoutMs });
}

module.exports = { extractFromPdf, extractFromText, isConfigured };
