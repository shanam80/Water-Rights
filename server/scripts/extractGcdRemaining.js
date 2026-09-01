// Final pass at the 8 districts the statewide run couldn't process.
// Run with: node server/scripts/extractGcdRemaining.js
//
// The briefing groups all 8 as "oversized scanned PDFs," but diagnosing
// them individually (2026-08-31) showed three genuinely different causes:
//
//   1. Five really are too big for a single API request (33-179 MB).
//      Handled here by splitting into page-range chunks with pdf-lib,
//      extracting each, then merging — see mergeExtractions below.
//   2. Three were not size problems at all:
//      - Hays Trinity: the district's own site returns 403 to any
//        non-browser request (full browser headers didn't help). TWDB
//        hosts its own copy, which downloads fine — using that instead.
//      - Mesa UWCD: TWDB's directory calls this a .docx, but the file at
//        that Google Drive ID is actually a PDF (verified by its %PDF
//        magic bytes) — which is why the docx parser failed on it. Also
//        needed Drive's real download host, since the `uc?export=download`
//        form returns an HTML interstitial rather than the file.
//      - Post Oak Savannah: TWDB's directory links to a file that 404s on
//        TWDB's own server, and the district site's copy is gone too. The
//        2017 plan is still hosted and works, so that's what's used —
//        recorded as plan_year 2017 so the page shows its real age rather
//        than implying it's current.
require('dotenv').config();
const { PDFDocument } = require('pdf-lib');
const { fetchWithTimeout } = require('../lib/http');
const { extractFromPdf, isConfigured } = require('../lib/anthropic');
const { upsertRestrictions } = require('../services/texas/gcdRestrictions');

const TWDB = 'https://www.twdb.texas.gov';

const DISTRICTS = [
  // --- Not size problems; fixed by using a reachable source ---
  {
    districtName: 'Hays Trinity GCD',
    url: `${TWDB}/groundwater/docs/GCD/htgcd/htgcd_mgmt_plan2016.pdf`,
    planYear: 2016,
    note: "The district's own site blocks automated requests, so this is TWDB's archived copy. A newer 2026 plan exists on the district's website.",
  },
  {
    districtName: 'Mesa UWCD',
    url: 'https://drive.usercontent.google.com/download?id=1UDhHMzGd_urNgRtjuPl5fs85wuNwfbbS&export=download',
    planYear: 2024,
    note: null,
  },
  {
    districtName: 'Post Oak Savannah GCD',
    url: `${TWDB}/groundwater/docs/GCD/posgcd/posgcd_mgmt_plan2017.pdf`,
    planYear: 2017,
    note: "TWDB lists a newer 2022 amended plan, but the link to it 404s on TWDB's own server and the district's copy is no longer posted, so this is the most recent version actually retrievable. Check with the district for the current plan.",
  },
  // --- Genuinely oversized; handled by chunking ---
  { districtName: 'Wintergarden GCD', url: `${TWDB}/groundwater/docs/GCD/wgcd/wgcd_mgmt_plan2016.pdf`, planYear: 2016 },
  { districtName: 'Lone Wolf GCD', url: 'https://lonewolfgwcd.org/wp-content/uploads/2025/11/LWGCD-Management-Plan-2025-2030-combined-2.pdf', planYear: 2025 },
  { districtName: 'Medina County GCD', url: `${TWDB}/groundwater/docs/GCD/mcgcd/mcgcd_mgmt_plan2022.pdf`, planYear: 2022 },
  { districtName: 'Headwaters GCD', url: `${TWDB}/groundwater/docs/GCD/huwcd/hgcd_mgmt_plan2022_amended.pdf`, planYear: 2022 },
  { districtName: 'Lower Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/ltgcd/ltgcd_mgmt_plan2019.pdf`, planYear: 2019 },
];

// Base64 inflates bytes by ~33%, and the API rejected the 34 MB originals,
// so chunks are targeted well under that rather than at the exact ceiling.
const TARGET_CHUNK_BYTES = 9 * 1024 * 1024;
// Hard ceiling a chunk may not exceed; anything larger gets halved again.
const MAX_CHUNK_BYTES = 12 * 1024 * 1024;
const SINGLE_CALL_LIMIT_BYTES = 14 * 1024 * 1024;

const EXTRACTION_PROMPT = `You are reading part of a Texas Groundwater Conservation District's management plan (a legal document, likely scanned — read the page images directly).

This may be only a section of a longer document, so many fields will legitimately not appear in what you're given. Return null for anything not present in THIS excerpt rather than guessing or inferring from general knowledge.

Extract ONLY what this document actually states. Reply with ONLY a single JSON object, no other text:

{
  "summary": "2-3 plain-language sentences a landowner would understand, summarizing the district's approach to regulating groundwater use. Null if this excerpt doesn't describe it.",
  "spacingRules": "Well spacing requirements (distances between wells, distance from property lines), exact figures and units as stated. Null if not in this excerpt.",
  "productionLimits": "Pumping/production limits (acre-feet per acre per year, gpm caps), exact figures as stated. Null if not in this excerpt.",
  "permittingThresholds": "What triggers a permit vs. an exempt well (gpm or horsepower thresholds, domestic/livestock exemptions), exact figures as stated. Null if not in this excerpt.",
  "droughtRules": "Drought or curtailment triggers and what they require. Null if not in this excerpt.",
  "confidence": "high, medium, or low — confidence that the above is accurate given what's actually in this excerpt",
  "notes": "Anything ambiguous or worth a human double-checking. Null if none."
}`;

const RESTRICTION_FIELDS = ['summary', 'spacingRules', 'productionLimits', 'permittingThresholds', 'droughtRules'];
const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };

async function downloadBuffer(url) {
  const res = await fetchWithTimeout(url, {}, 180000);
  if (!res.ok) throw new Error(`Download responded with status ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== '%PDF') {
    throw new Error(`Downloaded file is not a PDF (starts with ${JSON.stringify(buf.subarray(0, 8).toString())})`);
  }
  return buf;
}

function parseExtractionJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Reply had no JSON object:\n${text.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

// Builds one chunk covering pages [from, to] (0-indexed, inclusive).
async function buildChunk(source, from, to) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, Array.from({ length: to - from + 1 }, (_, i) => from + i));
  copied.forEach((p) => out.addPage(p));
  return { from, to, bytes: Buffer.from(await out.save()) };
}

// Splits into page ranges small enough to send. A first pass sizes chunks
// from the document's average bytes-per-page, but that alone isn't safe:
// page sizes vary enormously in scanned plans (Lower Trinity's average
// implied 6 pages/chunk, yet one such chunk still came out at 19.9 MB
// because a few pages are far heavier than the rest). So any chunk that
// still exceeds the limit is recursively halved until it fits, rather than
// trusting the average.
async function splitIntoChunks(buffer) {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  const bytesPerPage = buffer.length / pageCount;
  const pagesPerChunk = Math.max(1, Math.floor(TARGET_CHUNK_BYTES / bytesPerPage));

  const chunks = [];
  async function emit(from, to) {
    const chunk = await buildChunk(source, from, to);
    if (chunk.bytes.length <= MAX_CHUNK_BYTES || from === to) {
      chunks.push(chunk);
      return;
    }
    const mid = Math.floor((from + to) / 2);
    await emit(from, mid);
    await emit(mid + 1, to);
  }

  for (let start = 0; start < pageCount; start += pagesPerChunk) {
    await emit(start, Math.min(start + pagesPerChunk, pageCount) - 1);
  }

  // Ranges are reported to the reader 1-indexed.
  return {
    chunks: chunks.map((c) => ({ from: c.from + 1, to: c.to + 1, bytes: c.bytes })),
    pageCount,
  };
}

// Combines per-chunk results: first chunk that actually found a given field
// wins. Confidence reflects the chunk that supplied the most content, since
// empty chunks reporting "high confidence in finding nothing" shouldn't
// inflate or deflate the result.
function mergeExtractions(results, pageCount, chunkCount) {
  const merged = {};
  let bestChunk = null;
  let bestFieldCount = -1;

  for (const r of results) {
    const fieldCount = RESTRICTION_FIELDS.filter((f) => r[f]).length;
    if (fieldCount > bestFieldCount) { bestFieldCount = fieldCount; bestChunk = r; }
    for (const f of RESTRICTION_FIELDS) {
      if (!merged[f] && r[f]) merged[f] = r[f];
    }
  }

  const chunkNotes = results.map((r, i) => (r.notes ? `[pages ${r._range}] ${r.notes}` : null)).filter(Boolean);
  merged.confidence = bestChunk?.confidence && CONFIDENCE_RANK[bestChunk.confidence] ? bestChunk.confidence : 'low';
  merged.notes = [
    `This ${pageCount}-page document exceeded the size a single request can carry, so it was read in ${chunkCount} sequential parts and the findings combined.`,
    ...chunkNotes,
  ].join(' ');
  return merged;
}

async function extractDistrict(d) {
  console.log(`  Downloading ${d.url}`);
  const buffer = await downloadBuffer(d.url);
  const mb = (buffer.length / 1048576).toFixed(1);

  let extracted;
  if (buffer.length <= SINGLE_CALL_LIMIT_BYTES) {
    console.log(`  ${mb} MB — single request. Extracting…`);
    extracted = parseExtractionJson(await extractFromPdf({ pdfBase64: buffer.toString('base64'), prompt: EXTRACTION_PROMPT }));
  } else {
    const { chunks, pageCount } = await splitIntoChunks(buffer);
    console.log(`  ${mb} MB / ${pageCount} pages — splitting into ${chunks.length} parts.`);
    const results = [];
    for (const [i, chunk] of chunks.entries()) {
      const range = `${chunk.from}-${chunk.to}`;
      process.stdout.write(`    part ${i + 1}/${chunks.length} (pages ${range}, ${(chunk.bytes.length / 1048576).toFixed(1)} MB)… `);
      try {
        const r = parseExtractionJson(await extractFromPdf({ pdfBase64: chunk.bytes.toString('base64'), prompt: EXTRACTION_PROMPT }));
        r._range = range;
        results.push(r);
        console.log(RESTRICTION_FIELDS.filter((f) => r[f]).length + ' field(s)');
      } catch (err) {
        console.log(`FAILED: ${err.message.slice(0, 80)}`);
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (results.length === 0) throw new Error('every part failed');
    extracted = mergeExtractions(results, pageCount, chunks.length);
  }

  if (d.note) extracted.notes = [d.note, extracted.notes].filter(Boolean).join(' ');

  await upsertRestrictions({
    districtName: d.districtName,
    sourcePdfUrl: d.url,
    planYear: d.planYear,
    ...extracted,
  });
  const found = RESTRICTION_FIELDS.filter((f) => extracted[f]).length;
  console.log(`  Saved. ${found}/${RESTRICTION_FIELDS.length} fields, confidence: ${extracted.confidence}`);
}

async function run() {
  if (!isConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }
  const failures = [];
  for (const d of DISTRICTS) {
    console.log(`\n=== ${d.districtName} ===`);
    try {
      await extractDistrict(d);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failures.push(`${d.districtName}: ${err.message}`);
    }
  }
  console.log(`\nDone. ${DISTRICTS.length - failures.length}/${DISTRICTS.length} succeeded.`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(0);
}

run();
