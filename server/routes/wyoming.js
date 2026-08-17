const express = require('express');
const { findNearbyGroundwaterRights } = require('../services/wyoming/waterRights');

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

// GET /api/wyoming/water-rights?lat=&lon=
// Nearby groundwater rights (wells + springs) from WSGS's public Groundwater
// Atlas, sourced from the State Engineer's Office. Does not cover surface
// water rights (ditches/canals off a stream) or reservoirs — that data
// isn't available outside Wyoming's login-walled e-Permit system.
router.get('/water-rights', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findNearbyGroundwaterRights(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
