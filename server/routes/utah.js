const express = require('express');
const { findNearbyWaterRights } = require('../services/utah/waterRights');
const { findNearbyWellLogs, scrapeWellLog } = require('../services/utah/wells');
const { fetchParcelAtPoint } = require('../services/utah/parcels');

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

// GET /api/utah/water-rights?lat=&lon=
// Nearby points of diversion from Utah's WRPOD dataset, sorted by distance.
router.get('/water-rights', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findNearbyWaterRights(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/utah/wells/nearby?lat=&lon=
// Nearby well-log index records (location, associated water right, whether
// a drilling log is on file).
router.get('/wells/nearby', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findNearbyWellLogs(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/utah/wells/:win/log
// The actual drilling-log detail for one well, by WIN — depth, casing,
// drilling method, and water-level readings over time.
router.get('/wells/:win/log', async (req, res) => {
  try {
    const result = await scrapeWellLog(req.params.win);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/utah/parcel?lat=&lon=
router.get('/parcel', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await fetchParcelAtPoint(point.lat, point.lon);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Utah's statewide parcel dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
