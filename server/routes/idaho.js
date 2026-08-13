const express = require('express');
const { searchWaterRightsAtPoint } = require('../services/idaho/waterRights');
const { findNearbyWells } = require('../services/idaho/wells');

const router = express.Router();

function requireLatLon(req, res) {
  const latN = Number(req.query.lat);
  const lonN = Number(req.query.lon);
  if (Number.isNaN(latN) || Number.isNaN(lonN)) {
    res.status(400).json({ error: 'Query params required: lat (number), lon (number).' });
    return null;
  }
  return { lat: latN, lon: lonN };
}

// GET /api/idaho/water-rights?lat=&lon=
// Every water-right stage (claim, permit, license/decree) whose
// place-of-use polygon covers this point, translated and combined.
router.get('/water-rights', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await searchWaterRightsAtPoint(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/idaho/wells/nearby?lat=&lon=
// Nearest wells on file within ~1.3 miles, sorted by distance. Idaho's
// bulk well data already includes depth/yield/static water level directly
// (no scraping needed, unlike Colorado).
router.get('/wells/nearby', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findNearbyWells(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
