const express = require('express');
const { findNearestWellPermit } = require('../services/colorado/wellPermits');
const { scrapeWellCompletion } = require('../services/colorado/wellCompletionScraper');

const router = express.Router();

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
