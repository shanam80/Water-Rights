const express = require('express');
const { createProfessionalInterest } = require('../services/professionalInterest');

const router = express.Router();

// POST /api/professional-interest
// Email-only interest signup for a possible future paid professional tier.
// Public, no auth — this is a demand-signal capture, not a real account.
router.post('/', async (req, res) => {
  try {
    const result = await createProfessionalInterest(req.body || {});
    res.status(201).json({ signup: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
