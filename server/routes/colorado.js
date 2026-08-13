const express = require('express');
const { findNearestWellPermit } = require('../services/colorado/wellPermits');
const { scrapeWellCompletion } = require('../services/colorado/wellCompletionScraper');
const { fetchParcelAtPoint } = require('../services/colorado/parcels');
const { searchWaterRightsByCounty, searchWaterRightsNearPoint } = require('../services/colorado/waterRights');

const router = express.Router();

// GET /api/colorado/parcel?lat=40.2&lon=-104.3
// Whatever parcel polygon (if any) contains this point, including its
// boundary shape for on-parcel matching elsewhere.
router.get('/parcel', async (req, res) => {
  const latN = Number(req.query.lat);
  const lonN = Number(req.query.lon);
  if (Number.isNaN(latN) || Number.isNaN(lonN)) {
    return res.status(400).json({ error: 'Query params required: lat (number), lon (number).' });
  }
  try {
    const result = await fetchParcelAtPoint(latN, lonN);
    if (result.notFound) {
      return res.status(404).json({ error: "No parcel found at this point in Colorado's statewide dataset.", notFound: true });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/colorado/water-rights?county=WELD
// GET /api/colorado/water-rights?county=WELD&lat=40.2&lon=-104.3
// Without lat/lon: the plain translated list of everything on file for the
// county. With lat/lon: also looks up the parcel at that point and splits
// results into on-parcel vs. nearby, sorted by distance — mirrors the
// prototype's address/map-click search flow.
router.get('/water-rights', async (req, res) => {
  const { county } = req.query;
  if (!county) {
    return res.status(400).json({ error: 'Query param required: county (string).' });
  }
  const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
  const hasPoint = req.query.lat !== undefined && req.query.lon !== undefined;

  try {
    if (!hasPoint) {
      const result = await searchWaterRightsByCounty(county, pageSize);
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
      // A parcel lookup failure shouldn't block the water-rights search
      // itself — it just means on-parcel matching can't run this time.
      parcel = { error: err.message };
    }

    const parcelRings = parcel && !parcel.error && !parcel.notFound ? parcel.rings : null;
    const result = await searchWaterRightsNearPoint(county, latN, lonN, { pageSize, parcelRings });
    res.json({ parcel, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/colorado/well-completion/:receipt
// Scraped construction/yield data for one well permit, by its receipt number.
router.get('/well-completion/:receipt', async (req, res) => {
  try {
    const result = await scrapeWellCompletion(req.params.receipt);
    if (result.notFound) {
      return res.status(404).json({ error: 'No well permit found for that receipt number.', receipt: req.params.receipt });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/colorado/wells/nearest?county=WELD&lat=40.2&lon=-104.3
// Finds the nearest bulk well permit record to a point, then enriches it
// with scraped construction detail from that permit's own detail page.
router.get('/wells/nearest', async (req, res) => {
  const { county, lat, lon } = req.query;
  const latN = Number(lat);
  const lonN = Number(lon);

  if (!county || Number.isNaN(latN) || Number.isNaN(lonN)) {
    return res.status(400).json({ error: 'Query params required: county (string), lat (number), lon (number).' });
  }

  try {
    const nearest = await findNearestWellPermit(county, latN, lonN);
    if (nearest.notFound) {
      return res.status(404).json({ error: 'No well permit records found for that county.', county });
    }

    const receipt = nearest.row.receipt;
    let completion = null;
    if (receipt) {
      try {
        completion = await scrapeWellCompletion(receipt);
      } catch (err) {
        // The nearest-permit match is still useful even if the detail page
        // scrape fails (e.g. the state's site is briefly down) — degrade
        // gracefully instead of failing the whole request.
        completion = { error: err.message, receipt };
      }
    }

    res.json({
      distanceMiles: nearest.distanceMiles,
      totalPermitsOnFileInCounty: nearest.totalOnFile,
      bulkRecord: nearest.row,
      completion,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
