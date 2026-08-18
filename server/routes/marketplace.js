const express = require('express');
const { createListing, listListings, getListing, getListingForOwner, updateListing } = require('../services/marketplace/listings');
const { createInquiry, getInquiriesForListing } = require('../services/marketplace/inquiries');
const { getThread, postMessage } = require('../services/marketplace/messages');

const router = express.Router();

// POST /api/marketplace/listings
// Creates a listing. Returns the listing plus its editToken — shown here
// once, never again. Whoever holds that token can later edit or remove
// this listing (see PATCH below); there's no account/login to recover it.
router.post('/listings', async (req, res) => {
  try {
    const { listing, editToken } = await createListing(req.body || {});
    res.status(201).json({ listing, editToken });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/marketplace/listings?state=&status=&minPrice=&maxPrice=
// Browse/search. Defaults to active listings only.
router.get('/listings', async (req, res) => {
  try {
    const { state, status } = req.query;
    const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
    const listings = await listListings({ state, status, minPrice, maxPrice });
    res.json({ listings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/marketplace/listings/:id
// One listing, public view (no contact email — that only reaches the
// seller via an inquiry).
router.get('/listings/:id', async (req, res) => {
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  res.json({ listing });
});

// GET /api/marketplace/listings/:id/manage?token=
// Owner view: includes contact email and every inquiry received. Requires
// the edit token from creation.
router.get('/listings/:id/manage', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token query param is required.' });

  const listing = await getListingForOwner(req.params.id, token);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.forbidden) return res.status(403).json({ error: 'That token does not match this listing.' });

  const inquiries = await getInquiriesForListing(req.params.id, token);
  res.json({ listing, inquiries: Array.isArray(inquiries) ? inquiries : [] });
});

// PATCH /api/marketplace/listings/:id?token=
// Edit a listing's own fields, or change its status (e.g. mark "sold").
// Requires the edit token.
router.patch('/listings/:id', async (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(400).json({ error: 'token is required (query param or body field).' });

  try {
    const result = await updateListing(req.params.id, token, req.body || {});
    if (!result) return res.status(404).json({ error: 'Listing not found.' });
    if (result.forbidden) return res.status(403).json({ error: 'That token does not match this listing.' });
    res.json({ listing: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/marketplace/listings/:id/inquiries
// A buyer contacting the seller. Public — no token needed to send one,
// only to read them back (see /manage above).
router.post('/listings/:id/inquiries', async (req, res) => {
  try {
    const result = await createInquiry(req.params.id, req.body || {});
    if (result.notFound) return res.status(404).json({ error: 'Listing not found.' });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/marketplace/inquiries/:id/thread?token=
// The full in-platform conversation for one inquiry. token is either the
// buyer's own buyer_token (from their confirmation email) or the seller's
// listing edit_token — whichever matches determines which side you're
// viewing as.
router.get('/inquiries/:id/thread', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token query param is required.' });

  const result = await getThread(req.params.id, token);
  if (result.forbidden) return res.status(403).json({ error: 'That token does not match this conversation.' });
  res.json(result);
});

// POST /api/marketplace/inquiries/:id/messages
// Post a reply, as either side (see token note above).
router.post('/inquiries/:id/messages', async (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(400).json({ error: 'token is required (query param or body field).' });

  try {
    const result = await postMessage(req.params.id, token, req.body?.message);
    if (result.forbidden) return res.status(403).json({ error: 'That token does not match this conversation.' });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
