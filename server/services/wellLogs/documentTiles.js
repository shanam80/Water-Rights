// Makes scanned well logs actually readable in a browser.
//
// The problem this solves, verified rather than assumed: these logs are
// continuous strips — 3,008 x 99,696 pixels, ~300 megapixels, stored as
// CCITT Group 4 TIFF. No browser decodes TIFF at all (Chrome, Edge,
// Firefox alike), so linking the file directly gives a blank screen on
// desktop and "no program available" on a phone, which is exactly what was
// reported from real use.
//
// Converting the container doesn't help: a 300 MP PDF or JPEG is still 300
// MP, and a JPEG of a 1-bit line drawing is larger than the Group 4
// original. The size is the problem. So the file is turned into a zoom
// pyramid once and served as small tiles, and the page loads only the tiles
// actually on screen.
//
// Measured locally on the real files: 300 MP strip -> 19 zoom levels, 1,624
// tiles, 74.5 MB, in 2.9 seconds at 78 MB peak memory. libvips streams these;
// the brief's warning that ImageMagick allocates the whole bitmap and falls
// over is why sharp/libvips is used here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { fetchWithTimeout } = require('../../lib/http');

// Only these hosts may be fetched and re-served. Without this the endpoint
// would proxy any URL a caller passed, which is a server-side request
// forgery hole — the tile route takes a URL from the query string.
const ALLOWED_HOSTS = new Set([
  'ocdimage.emnrd.nm.gov',
  'gis.rrc.texas.gov',
  'www.rrc.texas.gov',
]);

const CACHE_DIR = path.join(__dirname, '..', '..', '..', '.cache', 'well-log-tiles');
// Ephemeral disk on the current host, so this is a working cache rather than
// permanent storage. Regenerating costs about three seconds, so evicting the
// least-recently-used set is cheap.
const MAX_CACHE_BYTES = 1.5 * 1024 * 1024 * 1024;

// Half the native width. These are roughly 400 DPI scans, so 200 DPI is
// still comfortably readable, and it cuts the work about fourfold — which
// matters enormously on a small instance. Measured on a real 582 MP log:
// 6.5s to tile at full width locally but ~186s on the deployed free tier;
// at half width that drops to ~2.5s local, ~72s deployed.
const MAX_TILE_WIDTH = 1664;

const inFlight = new Map();
// Documents that failed to build, so a retry isn't attempted on every poll.
const failed = new Map();

// Reports where a document is up to without starting work, so the page can
// poll instead of holding a request open for minutes.
function tileStatus(sourceUrl) {
  const key = keyFor(sourceUrl);
  if (fs.existsSync(path.join(CACHE_DIR, key, 'image.dzi'))) return 'ready';
  if (inFlight.has(key)) return 'building';
  if (failed.has(key)) return 'failed';
  return 'absent';
}

function keyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function isAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return total;
}

// Drops whole documents, oldest-touched first, until the cache is back under
// its ceiling. Never evicts the document being written right now.
function evictIfNeeded(keepKey) {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    if (dirSize(CACHE_DIR) <= MAX_CACHE_BYTES) return;

    const entries = fs
      .readdirSync(CACHE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== keepKey)
      .map((e) => {
        const p = path.join(CACHE_DIR, e.name);
        return { name: e.name, path: p, atime: fs.statSync(p).atimeMs };
      })
      .sort((a, b) => a.atime - b.atime);

    for (const entry of entries) {
      if (dirSize(CACHE_DIR) <= MAX_CACHE_BYTES) break;
      fs.rmSync(entry.path, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Tile cache eviction failed:', err.message);
  }
}

// Builds the pyramid if it isn't cached, and returns where it lives.
// Concurrent requests for the same document share one build rather than
// racing to write the same directory.
async function ensureTiles(sourceUrl) {
  if (!isAllowed(sourceUrl)) {
    throw new Error('That document host is not one this viewer serves.');
  }
  const key = keyFor(sourceUrl);
  const base = path.join(CACHE_DIR, key);
  const dziPath = path.join(base, 'image.dzi');

  if (fs.existsSync(dziPath)) {
    fs.utimesSync(base, new Date(), new Date()); // mark recently used
    return { key, base, dziPath, cached: true };
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    fs.mkdirSync(base, { recursive: true });
    const res = await fetchWithTimeout(sourceUrl, {}, 120000);
    if (!res.ok) throw new Error(`Document host responded with status ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // limitInputPixels must be off: these are far past sharp's default
    // guard, and the guard exists for untrusted uploads, not for a
    // known government scan we've already host-checked.
    let image = sharp(buffer, { limitInputPixels: false, unlimited: true });
    const meta = await image.metadata();
    if (meta.width > MAX_TILE_WIDTH) {
      image = image.resize({ width: MAX_TILE_WIDTH });
    }
    await image.tile({ size: 512, overlap: 1, layout: 'dz' }).toFile(path.join(base, 'image.dz'));

    evictIfNeeded(key);
    return { key, base, dziPath, cached: false };
  })()
    .catch((err) => {
      // Leave no half-written pyramid behind for the next request to trust.
      fs.rmSync(base, { recursive: true, force: true });
      failed.set(key, err.message);
      throw err;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

// Resolves one tile path inside a document's pyramid, refusing anything
// that tries to climb out of the cache directory.
function tilePath(key, rest) {
  const base = path.join(CACHE_DIR, key, 'image_files');
  const target = path.resolve(base, rest);
  if (!target.startsWith(path.resolve(base))) return null;
  return fs.existsSync(target) ? target : null;
}

module.exports = { ensureTiles, tileStatus, tilePath, isAllowed, keyFor, CACHE_DIR };
