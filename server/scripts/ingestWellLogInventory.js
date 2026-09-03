// Caches Texas well log depths + metadata from the Railroad Commission's
// monthly log inventory workbooks.
//   node server/scripts/ingestWellLogInventory.js [months]
//
// Why a scraper and not a URL pattern: the files are named predictably
// (MMYYYY_master_inventory.xlsx) but they are NOT served from a predictable
// path — each sits behind a random media slug, e.g.
//   /media/egwbfdbv/072026_master_inventory.xlsx
//   /media/5z2dprbc/062026_master_inventory.xlsx
// so the filename alone can't be constructed into a working URL. The link
// list has to be read off the RRC's page, which is what this does.
//
// Each workbook has ONE SHEET PER RRC DISTRICT (12 of them) — reading only
// the first sheet returns a single record instead of the full ~334, so
// every sheet is parsed.
require('dotenv').config();
const xlsx = require('node-xlsx');
const { fetchWithTimeout } = require('../lib/http');
const { upsertInventoryRow, countInventory } = require('../services/wellLogs/inventory');

const INDEX_PAGE =
  'https://www.rrc.texas.gov/oil-and-gas/research-and-statistics/obtaining-commission-records/oil-gas-well-records-gis-well-logs/';

const COLUMNS = {
  api: 'API Number',
  top: 'Top Log Interval',
  bottom: 'Bottom Total Depth',
  operator: 'Operator Name',
  lease: 'Lease Name',
  field: 'Field Name',
  wellNo: 'Well Number',
  county: 'County Name',
  description: 'Log Description',
  docDate: 'Document Date',
  imageSize: 'Image Size',
  imagePath: 'Image path',
};

async function findInventoryFiles() {
  const res = await fetchWithTimeout(INDEX_PAGE, {}, 45000);
  if (!res.ok) throw new Error(`RRC index page responded with status ${res.status}`);
  const html = await res.text();

  const links = new Map(); // MMYYYY -> absolute URL
  const re = /href="([^"]*?\/media\/[^"]*?(\d{6})_master_inventory\.xlsx?)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].startsWith('http') ? m[1] : `https://www.rrc.texas.gov${m[1]}`;
    if (!links.has(m[2])) links.set(m[2], url);
  }
  // MMYYYY sorts wrong as a string, so order by the real date it encodes.
  return [...links.entries()]
    .map(([code, url]) => ({ code, url, sortKey: code.slice(2) + code.slice(0, 2) }))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

// The RRC leaves this field at 0 on wells thousands of feet deep, so 0 is
// "not recorded", not "starts at the surface". Stored as NULL so the UI can
// show it as genuinely unknown.
function toDepth(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function formatFromPath(path){
  const ext = String(path || '').toLowerCase().split('.').pop();
  if (ext === 'tif' || ext === 'tiff') return 'TIFF';
  if (ext === 'las') return 'LAS';
  if (ext === 'pdf') return 'PDF';
  return null;
}

function clean(value) {
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
}

function parseWorkbook(buffer, sourceFile) {
  const sheets = xlsx.parse(buffer);
  const rows = [];
  for (const sheet of sheets) {
    const data = sheet.data || [];
    if (data.length < 2) continue;
    const header = data[0].map((h) => String(h ?? '').trim());
    const idx = {};
    for (const [key, label] of Object.entries(COLUMNS)) {
      idx[key] = header.findIndex((h) => h.toLowerCase() === label.toLowerCase());
    }
    if (idx.api < 0) continue;

    for (const raw of data.slice(1)) {
      const api = clean(raw[idx.api]);
      if (!api) continue;
      rows.push({
        api,
        topLogIntervalFt: idx.top >= 0 ? toDepth(raw[idx.top]) : null,
        bottomTotalDepthFt: idx.bottom >= 0 ? toDepth(raw[idx.bottom]) : null,
        operatorName: idx.operator >= 0 ? clean(raw[idx.operator]) : null,
        leaseName: idx.lease >= 0 ? clean(raw[idx.lease]) : null,
        fieldName: idx.field >= 0 ? clean(raw[idx.field]) : null,
        wellNumber: idx.wellNo >= 0 ? clean(raw[idx.wellNo]) : null,
        countyName: idx.county >= 0 ? clean(raw[idx.county]) : null,
        logDescription: idx.description >= 0 ? clean(raw[idx.description]) : null,
        documentDate: idx.docDate >= 0 ? clean(raw[idx.docDate]) : null,
        imageSize: idx.imageSize >= 0 ? clean(raw[idx.imageSize]) : null,
        // Format comes from the stored image's extension — the inventory
        // has no format column of its own.
        logFormat: idx.imagePath >= 0 ? formatFromPath(raw[idx.imagePath]) : null,
        sourceFile,
      });
    }
  }
  return rows;
}

async function run() {
  const months = Number(process.argv[2]) || 24;
  console.log(`Reading the RRC inventory index…`);
  const files = await findInventoryFiles();
  console.log(`Found ${files.length} monthly files; ingesting the most recent ${Math.min(months, files.length)}.\n`);

  let ingested = 0;
  let withDepth = 0;
  let failed = 0;

  for (const file of files.slice(0, months)) {
    process.stdout.write(`  ${file.code}… `);
    try {
      const res = await fetchWithTimeout(file.url, {}, 120000);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const rows = parseWorkbook(buffer, `${file.code}_master_inventory.xlsx`);
      for (const row of rows) {
        await upsertInventoryRow(row);
        ingested += 1;
        if (row.topLogIntervalFt) withDepth += 1;
      }
      console.log(`${rows.length} records`);
    } catch (err) {
      failed += 1;
      console.log(`FAILED: ${err.message}`);
    }
  }

  const totals = await countInventory();
  console.log(`\nIngested ${ingested} records (${withDepth} carried a usable start depth).`);
  if (failed) console.log(`${failed} file(s) failed.`);
  console.log(`Table now holds ${totals.total} wells, ${totals.withDepth} with a known start depth.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Ingestion failed:', err.message);
  process.exit(1);
});
