// Manual/on-demand run of the same check the server also runs on its own
// 24h interval (see server/index.js) — useful for testing without waiting
// a day, or for triggering a check from outside the running process.
require('dotenv').config();
const { checkAllSavedSearches } = require('../services/savedSearches');

checkAllSavedSearches()
  .then((results) => {
    console.log(`Checked ${results.length} saved search(es).`);
    results.forEach((r) => {
      if (r.error) console.log(`  #${r.checked}: FAILED — ${r.error}`);
      else console.log(`  #${r.checked}: ${r.newCount} new right(s)`);
    });
    process.exit(0);
  })
  .catch((err) => {
    console.error('Saved-search check run failed:', err.message);
    process.exit(1);
  });
