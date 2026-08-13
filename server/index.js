const path = require('node:path');
const express = require('express');
const coloradoRoutes = require('./routes/colorado');
const idahoRoutes = require('./routes/idaho');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'western-water-rights backend' });
});

app.use('/api/colorado', coloradoRoutes);
app.use('/api/idaho', idahoRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Western Water Rights backend listening on http://localhost:${PORT}`);
});
