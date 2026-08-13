// Manual smoke test, not a full test framework — run with:
//   npm run test:well-scraper
// Checks the scraper against real, known-live receipt numbers so a broken
// parser (e.g. the state renames a data-fieldName) gets caught before it
// ships, per the "test every change before presenting it" lesson in the
// briefing doc.
const assert = require('node:assert');
const { scrapeWellCompletion } = require('./wellCompletionScraper');

async function run() {
  console.log('1. Partial-data record (Weld County, Final Permit, depth known, static water level blank)...');
  const partial = await scrapeWellCompletion('0000072A', { skipCache: true });
  assert.strictEqual(partial.notFound, undefined, 'should be found');
  assert.strictEqual(partial.permitNumber, '31611-FP');
  assert.strictEqual(partial.construction.depth_total.value, '104');
  assert.strictEqual(partial.construction.static_water_level.value, null);
  assert.strictEqual(partial.hasAnyConstructionDetail, true);
  console.log('   OK —', partial.construction.depth_total.value, partial.construction.depth_total.unit, 'depth,',
    'static water level correctly blank');

  console.log('2. Fuller record (Douglas County, Well Constructed, static water level + completion date present)...');
  const fuller = await scrapeWellCompletion('0002158', { skipCache: true });
  assert.strictEqual(fuller.permitStatus, 'Well Constructed');
  assert.strictEqual(fuller.construction.static_water_level.value, '54.00');
  assert.ok(fuller.construction.date_well_completed.value, 'completion date should be present');
  console.log('   OK — static water level', fuller.construction.static_water_level.value, fuller.construction.static_water_level.unit);

  console.log('3. Nonexistent receipt returns a clean not-found, not a crash...');
  const missing = await scrapeWellCompletion('0000000000', { skipCache: true });
  assert.strictEqual(missing.notFound, true);
  console.log('   OK — notFound: true');

  console.log('4. Caching: second call for the same receipt is served from cache...');
  const first = await scrapeWellCompletion('0000072A');
  const second = await scrapeWellCompletion('0000072A');
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(first.receipt, second.receipt);
  console.log('   OK — fromCache: true on repeat lookup');

  console.log('\nAll well-completion scraper checks passed.');
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
