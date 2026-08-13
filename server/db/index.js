// A single shared connection pool for the whole app. Reads DATABASE_URL
// (the standard env var name — both Neon and Render's own Postgres set
// this automatically when you attach a database).
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  // Fail loudly and immediately rather than letting every query error out
  // one at a time later with a less obvious message.
  throw new Error(
    'DATABASE_URL is not set. Set it to your Postgres connection string ' +
      '(e.g. from Neon) as an environment variable before starting the server.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon (and most hosted Postgres) require SSL; rejectUnauthorized:false
  // is the standard setting for providers using a shared/managed cert
  // chain that Node doesn't automatically trust.
  ssl: { rejectUnauthorized: false },
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
