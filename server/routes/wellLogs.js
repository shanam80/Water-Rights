const express = require('express');
const texas = require('../services/wellLogs/texas');
const newMexico = require('../services/wellLogs/newMexico');
const { getDepthsForApis } = require('../services/wellLogs/inventory');
const { ensureTiles, tileStatus, tilePath, isAllowed } = require('../services/wellLogs/documentTiles');
const fs = require('fs');

const router = express.Router();

// One interface, two implementations. Texas answers "which wells have logs"
// with a single layer query; New Mexico probes each well in the radius.
// Both return the same shape, so nothing downstream branches on state.
const SOURCES = { TX: texas, NM: newMexico };

// GET /api/well-logs?state=TX&lat=&lon=&radius=1
router.get('/', async (req, res) => {
  const state = String(req.query.state || 'TX').toUpperCase();
  const source = SOURCES[state];
  if (!source) {
    return res.status(400).json({ error: 'Query param "state" must be TX or NM.' });
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'Query params required: lat (number), lon (number).' });
  }

  // New Mexico costs one outbound probe per well, so its radius is capped
  // tighter than Texas's single-query search.
  const maxRadius = state === 'NM' ? 3 : 10;
  const radius = Math.min(Math.max(Number(req.query.radius) || 1, 0.1), maxRadius);

  try {
    const result = await source.searchWellLogsNearPoint(lat, lon, radius);
    res.json({ ...result, radiusMiles: radius, center: { lat, lon } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/well-logs/depths  { apis: [...] }
// Texas only. The RRC's map layer cannot say how deep a log starts, so this
// looks the batch up in the cached monthly inventories. An API with no row
// comes back absent, which the page renders as "no recorded start depth" —
// a real answer about the record, not an error.
router.post('/depths', async (req, res) => {
  const apis = req.body && req.body.apis;
  if (!Array.isArray(apis)) {
    return res.status(400).json({ error: 'Body must be { apis: [string, ...] }.' });
  }
  try {
    res.json({ depths: await getDepthsForApis(apis) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/well-logs/document?url=<encoded document url>
// Returns the zoom-pyramid descriptor for a scanned log, building it on
// first request. Browsers can't decode these TIFFs at all, so this is what
// makes them readable in the page instead of downloading to nothing.
router.get('/document', async (req, res) => {
  const url = req.query.url;
  if (!url || !isAllowed(url)) {
    return res.status(400).json({ error: 'A document URL from a supported state archive is required.' });
  }

  // Building a pyramid for one of these logs takes seconds on a fast box
  // but minutes on a small instance — a 582 MP scan measured 6s locally
  // against 186s deployed. Holding the request open for that long looks
  // exactly like a hang, so the work starts in the background and the page
  // polls. It shows the state's own thumbnail meanwhile.
  const status = tileStatus(url);
  if (status !== 'ready') {
    ensureTiles(url).catch((err) => console.error('Tile build failed:', err.message));
    return res.status(202).json({
      status: status === 'failed' ? 'retrying' : 'building',
      message: 'Preparing this scan for viewing.',
    });
  }

  try {
    const { key, dziPath } = await ensureTiles(url);
    const dzi = fs.readFileSync(dziPath, 'utf8');
    const width = Number((dzi.match(/Width="(\d+)"/) || [])[1]);
    const height = Number((dzi.match(/Height="(\d+)"/) || [])[1]);
    if (!width || !height) throw new Error('Could not read the document dimensions.');
    res.json({
      status: 'ready',
      key,
      width,
      height,
      tileSize: 512,
      overlap: 1,
      format: 'jpeg',
      tileUrlTemplate: `/api/well-logs/document/${key}/{level}/{x}_{y}.jpeg`,
      originalUrl: url,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/well-logs/document/:key/:level/:tile
router.get('/document/:key/:level/:tile', (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.key)) return res.status(400).end();
  const target = tilePath(req.params.key, `${req.params.level}/${req.params.tile}`);
  if (!target) return res.status(404).end();
  // These scans were last modified in 2002 — safe to cache hard.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(target);
});

module.exports = router;
