const express = require('express');
const { fetchParcelAtPoint } = require('../services/montana/parcels');
const { searchWaterRightsByCounty, searchWaterRightsNearPoint } = require('../services/montana/waterRights');

const router = express.Router();

// GET /api/montana/parcel?lat=&lon=
router.get('/parcel', async (req, res) => {
  const latN = Number(req.query.lat);
  const lonN = Number(req.query.lon);
  if (Number.isNaN(latN) || Number.isNaN(lonN)) {
    return res.status(400).json({ error: 'Query params required: lat (number), lon (number).' });
  }
  try {
    const result = await fetchParcelAtPoint(latN, lonN);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Montana's statewide dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/montana/water-rights?county=GALLATIN
// GET /api/montana/water-rights?county=GALLATIN&lat=45.55&lon=-111.15
// Without lat/lon: everything on file for the county (points of diversion
// + reservoirs). With lat/lon: also looks up the parcel at that point,
// splits diversions/reservoirs into on-parcel vs. nearby (sorted by
// distance), and includes any place-of-use polygon that covers this exact
// point — mirrors Colorado's combined search flow, plus Idaho-style
// polygon matching where Montana's data supports it.
router.get('/water-rights', async (req, res) => {
  const { county } = req.query;
  if (!county) {
    return res.status(400).json({ error: 'Query param required: county (string).' });
  }
  const hasPoint = req.query.lat !== undefined && req.query.lon !== undefined;

  try {
    if (!hasPoint) {
      const result = await searchWaterRightsByCounty(county);
      return res.json(result);
    }

    const latN = Number(req.query.lat);
    const lonN = Number(req.query.lon);
    if (Number.isNaN(latN) || Number.isNaN(lonN)) {
      return res.status(400).json({ error: 'lat and lon must both be numbers.' });
    }

    let parcel = null;
    try {
      parcel = await fetchParcelAtPoint(latN, lonN);
    } catch (err) {
      // A parcel lookup failure shouldn't block the water-rights search —
      // it just means on-parcel matching can't run this time.
      parcel = { error: err.message };
    }

    const parcelRings = parcel && !parcel.error && !parcel.notFound ? parcel.rings : null;
    const result = await searchWaterRightsNearPoint(county, latN, lonN, { parcelRings });
    res.json({ parcel, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
