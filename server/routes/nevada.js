const express = require('express');
const { fetchParcelAtPoint } = require('../services/nevada/parcels');
const { searchWaterRightsNearPoint } = require('../services/nevada/waterRights');
const { findNearbyWells } = require('../services/nevada/wells');

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

// GET /api/nevada/parcel?lat=&lon=
router.get('/parcel', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await fetchParcelAtPoint(point.lat, point.lon);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Nevada's statewide dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/nevada/water-rights?lat=&lon=
// No county-search mode here (unlike Colorado/Montana) — Nevada's county
// field is an opaque code with no verified decode table, so this is
// point-only, same pattern as Idaho/Utah. Looks up the parcel at the
// point, splits points of diversion into on-parcel vs. nearby (sorted by
// distance), and includes any place-of-use polygon covering this exact
// point.
router.get('/water-rights', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;

  let parcel = null;
  try {
    parcel = await fetchParcelAtPoint(point.lat, point.lon);
  } catch (err) {
    // A parcel lookup failure shouldn't block the water-rights search —
    // it just means on-parcel matching can't run this time.
    parcel = { error: err.message };
  }

  try {
    const parcelRings = parcel && !parcel.error && !parcel.notFound ? parcel.rings : null;
    const result = await searchWaterRightsNearPoint(point.lat, point.lon, { parcelRings });
    res.json({ parcel, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/nevada/wells/nearby?lat=&lon=
// Nearby wells with full construction detail already in the bulk data —
// depth, static water level, yield, drawdown — no scraper needed, unlike
// Colorado's or Utah's equivalent.
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
