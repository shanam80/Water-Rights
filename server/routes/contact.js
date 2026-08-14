const express = require('express');
const { createContactMessage } = require('../services/contact');

const router = express.Router();

// POST /api/contact
// General site contact, not tied to any listing. Public.
router.post('/', async (req, res) => {
  try {
    const result = await createContactMessage(req.body || {});
    res.status(201).json({ message: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
