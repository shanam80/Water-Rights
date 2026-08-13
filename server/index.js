const express = require('express');
const coloradoRoutes = require('./routes/colorado');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'western-water-rights backend' });
});

app.use('/api/colorado', coloradoRoutes);

app.listen(PORT, () => {
  console.log(`Western Water Rights backend listening on http://localhost:${PORT}`);
});
