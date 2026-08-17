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

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Western Water Rights backend listening on http://localhost:${PORT}`);
});
