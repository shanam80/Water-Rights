// Applies schema.sql against DATABASE_URL. Safe to run repeatedly — every
// statement in schema.sql uses IF NOT EXISTS, so re-running just confirms
// everything's already there instead of erroring.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./index');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Migration applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
