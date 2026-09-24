const express = require('express');
const { searchWaterRightsNearPoint } = require('../services/newMexico/waterRights');

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

// GET /api/new-mexico/water-rights?lat=&lon=&radius=
// Points of diversion from the Office of the State Engineer. NM records
// points (wells, surface declarations, surface permits) rather than the
// place-of-use polygons Idaho and Nevada publish.
router.get('/water-rights', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  const radiusMiles = req.query.radius ? Math.min(Math.max(Number(req.query.radius), 0.1), 25) : null;
  try {
    const result = await searchWaterRightsNearPoint(point.lat, point.lon, radiusMiles);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
