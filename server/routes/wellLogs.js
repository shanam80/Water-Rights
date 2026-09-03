const express = require('express');
const texas = require('../services/wellLogs/texas');
const newMexico = require('../services/wellLogs/newMexico');
const { getDepthsForApis } = require('../services/wellLogs/inventory');

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

module.exports = router;
