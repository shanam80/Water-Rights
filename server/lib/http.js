// A hung request looks identical to a crash from the outside (endless
// spinner, no error) because fetch() has no default timeout. Every outbound
// request in this project should go through this wrapper instead of raw
// fetch() so a stuck government server can't hang the whole app.
// dwr.state.co.us returns 403 for requests with no User-Agent header
// (confirmed live) — Node's fetch sends none by default, unlike a browser.
// A plain browser-like UA is enough to pass; this isn't spoofing a session
// or bypassing any login/paywall, just supplying a header real browsers
// always send anyway.
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: { ...DEFAULT_HEADERS, ...options.headers },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout };
