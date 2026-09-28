const express = require('express');
const { findNearbyGroundwaterRights } = require('../services/wyoming/waterRights');
const { fetchParcelAtPoint } = require('../services/wyoming/parcels');

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
  // Optional caller radius; omitted means each state's own default.
  const radiusMiles = req.query.radius ? Math.min(Math.max(Number(req.query.radius), 0.1), 25) : null;
  try {
    const result = await findNearbyGroundwaterRights(point.lat, point.lon, radiusMiles);
    // Whose land this is. Best-effort — a parcel failure shouldn't cost
    // someone their water-rights results.
    let parcel = null;
    try {
      parcel = await fetchParcelAtPoint(point.lat, point.lon);
    } catch (err) {
      parcel = { error: err.message };
    }
    res.json({ parcel, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/wyoming/parcel?lat=&lon=
// Whatever parcel polygon (if any) contains this point, from the state's
// own Statewide Parcel Viewer layer.
router.get('/parcel', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await fetchParcelAtPoint(point.lat, point.lon);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Wyoming's statewide dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
