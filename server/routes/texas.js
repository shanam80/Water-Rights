const express = require('express');
const { fetchParcelAtPoint } = require('../services/texas/parcels');
const { findGcdAtPoint, fetchAllDistricts, STATEWIDE_PRODUCTION_FEE_CAP } = require('../services/texas/gcd');
const { findNearbyWells } = require('../services/texas/wells');
const { getRestrictionsByDistrictName, listDistrictNamesWithRestrictions } = require('../services/texas/gcdRestrictions');
const { findNearbyMonitoringWells } = require('../services/texas/monitoringWells');

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
    if (result.inDistrict) {
      result.restrictions = await getRestrictionsByDistrictName(result.districtName);
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/texas/gcd/all
// Every groundwater district boundary statewide, generalized for map
// display, flagged with whether we hold its restriction rules. Powers the
// browse-the-districts map (as opposed to the point lookup above).
router.get('/gcd/all', async (req, res) => {
  try {
    const [districts, withRestrictions] = await Promise.all([
      fetchAllDistricts(),
      listDistrictNamesWithRestrictions().catch(() => []),
    ]);
    const haveRules = new Set(withRestrictions);
    res.json({
      districts: districts.map((d) => ({ ...d, hasRestrictions: haveRules.has(d.districtName) })),
      statewideProductionFeeCap: STATEWIDE_PRODUCTION_FEE_CAP,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/texas/gcd/district/:name
// One district's restriction rules, by its exact DistrictName — used when
// someone clicks a district on the map.
router.get('/gcd/district/:name', async (req, res) => {
  try {
    const restrictions = await getRestrictionsByDistrictName(req.params.name);
    res.json({ districtName: req.params.name, restrictions, statewideProductionFeeCap: STATEWIDE_PRODUCTION_FEE_CAP });
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

// GET /api/texas/monitoring-wells/nearby?lat=&lon=
// Regional groundwater-level context from TWDB's automated monitoring
// network (waterdatafortexas.org) — depth-to-water at nearby sensor wells,
// searched much wider than the bulk wells list since these are sparse.
router.get('/monitoring-wells/nearby', async (req, res) => {
  const point = requireLatLon(req, res);
  if (!point) return;
  try {
    const result = await findNearbyMonitoringWells(point.lat, point.lon);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
