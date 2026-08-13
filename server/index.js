require('dotenv').config();
const path = require('node:path');
const express = require('express');
const coloradoRoutes = require('./routes/colorado');
const idahoRoutes = require('./routes/idaho');
const utahRoutes = require('./routes/utah');
const marketplaceRoutes = require('./routes/marketplace');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'western-water-rights backend' });
});

app.use('/api/colorado', coloradoRoutes);
app.use('/api/idaho', idahoRoutes);
app.use('/api/utah', utahRoutes);
app.use('/api/marketplace', marketplaceRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Western Water Rights backend listening on http://localhost:${PORT}`);
});
