const express = require('express');
const { fetchParcelAtPoint } = require('../services/texas/parcels');
const { findGcdAtPoint } = require('../services/texas/gcd');
const { findNearbyWells } = require('../services/texas/wells');

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

// GET /api/texas/parcel?lat=&lon=
router.get('/parcel', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await fetchParcelAtPoint(point.lat, point.lon);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Texas's StratMap dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/texas/gcd?lat=&lon=
// Which Groundwater Conservation District (if any) covers this point.
router.get('/gcd', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findGcdAtPoint(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/texas/wells/nearby?lat=&lon=
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
