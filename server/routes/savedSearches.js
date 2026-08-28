const express = require('express');
const { createSavedSearch, deleteSavedSearch } = require('../services/savedSearches');

const router = express.Router();

// POST /api/saved-searches
// Body: { email, state, lat, lon, county (CO only), label }
router.post('/', async (req, res) => {
  try {
    const result = await createSavedSearch(req.body || {});
    res.status(201).json({ savedSearch: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/saved-searches/:token
// Unsubscribe — the token is the only credential needed, same pattern as
// a listing's edit_token or an inquiry's buyer_token.
router.delete('/:token', async (req, res) => {
  try {
    const deleted = await deleteSavedSearch(req.params.token);
    if (!deleted) return res.status(404).json({ error: 'No saved search found for that link — it may have already been removed.' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
