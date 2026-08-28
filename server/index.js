require('dotenv').config();
const path = require('node:path');
const express = require('express');
const coloradoRoutes = require('./routes/colorado');
const idahoRoutes = require('./routes/idaho');
const utahRoutes = require('./routes/utah');
const montanaRoutes = require('./routes/montana');
const nevadaRoutes = require('./routes/nevada');
const texasRoutes = require('./routes/texas');
const wyomingRoutes = require('./routes/wyoming');
const marketplaceRoutes = require('./routes/marketplace');
const contactRoutes = require('./routes/contact');
const professionalInterestRoutes = require('./routes/professionalInterest');
const savedSearchesRoutes = require('./routes/savedSearches');
const { checkAllSavedSearches } = require('./services/savedSearches');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'western-water-rights backend' });
});

app.use('/api/colorado', coloradoRoutes);
app.use('/api/idaho', idahoRoutes);
app.use('/api/utah', utahRoutes);
app.use('/api/montana', montanaRoutes);
app.use('/api/nevada', nevadaRoutes);
app.use('/api/texas', texasRoutes);
app.use('/api/wyoming', wyomingRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/professional-interest', professionalInterestRoutes);
app.use('/api/saved-searches', savedSearchesRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Western Water Rights backend listening on http://localhost:${PORT}`);
});

// Checks all saved searches for new water rights once a day. An in-process
// interval rather than a separate scheduled job/Render Cron service — this
// app is already running continuously, so this costs nothing extra to run.
// The tradeoff: it resets on every deploy/restart (fine — worst case a
// check is a bit late, never lost data, since each check just re-diffs
// against the last known snapshot) and depends on the process staying up,
// which it already needs to for the site itself to work.
const SAVED_SEARCH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  checkAllSavedSearches().catch((err) => console.error('Saved-search check run failed:', err.message));
}, SAVED_SEARCH_CHECK_INTERVAL_MS);
