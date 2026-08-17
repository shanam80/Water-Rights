// One-off/occasionally-rerun batch script — NOT part of the live server.
// Downloads each pilot district's current management-plan PDF straight from
// TWDB (or the district's own site, where TWDB just links out), asks Claude
// to pull structured restriction data out of it, and stores the result in
// gcd_restrictions. Run with: node server/scripts/extractGcdRestrictions.js
//
// district_name below is the exact string the live TWDB GCD boundary service
// returns for that district (confirmed 2026-08-16 by querying
// services.twdb.texas.gov's GCD MapServer at each district's headquarters
// coordinates) — it has to match exactly, since that's the join key the
// /api/texas/gcd route uses to attach restrictions to a boundary lookup.
// pdfUrl came from TWDB's own district directory pages (gcdinfo1/2/3.asp),
// not a guessed code — several districts (like Presidio here) host their
// current plan on their own site rather than twdb.texas.gov.
require('dotenv').config();
const { fetchWithTimeout } = require('../lib/http');
const { extractFromPdf, isConfigured } = require('../lib/anthropic');
const { upsertRestrictions } = require('../services/texas/gcdRestrictions');

const PILOT_DISTRICTS = [
  { districtName: 'High Plains UWCD #1', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/hpuwcd1/hpuwcd1_mgmt_plan2024.pdf', planYear: 2024 },
  { districtName: 'North Plains GCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/npgcd/npgcd_mgmt_plan2024.pdf', planYear: 2024 },
  { districtName: 'Panhandle GCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/panhandlegcd/pgcd_mgmt_plan2024.pdf', planYear: 2024 },
  { districtName: 'South Plains UWCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/spuwcd/spuwcd_mgmt_plan2024.pdf', planYear: 2024 },
  { districtName: 'Permian Basin UWCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/pbuwcd/pbuwcd_mgmt_plan2022.pdf', planYear: 2022 },
  { districtName: 'Glasscock GCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/ggcd/ggcd_mgmt_plan2025.pdf', planYear: 2025 },
  { districtName: 'Reeves County GCD', pdfUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/reecgcd/reecgcd_mgmt_plan2023.pdf', planYear: 2023 },
  { districtName: 'Presidio County UWCD', pdfUrl: 'https://pcuwcd.org/s/PCUWCD-Groundwater-Management-Plan-2025-2030_approved-tywz.pdf', planYear: 2025 },
];

const EXTRACTION_PROMPT = `You are reading a Texas Groundwater Conservation District management plan (a legal/regulatory document, possibly a scanned PDF with no text layer — read the page images directly).

Extract ONLY what this document actually states. Do not infer, estimate, or fill in typical/default values. Reply with ONLY a single JSON object, no other text, in exactly this shape:

{
  "summary": "2-3 plain-language sentences a landowner would understand, summarizing the district's overall approach to regulating groundwater use",
  "spacingRules": "Well spacing requirements (distances between wells, distance from property lines), with exact figures and units as stated. Null if not found.",
  "productionLimits": "Pumping/production limits (e.g. acre-feet per acre per year, gallons per minute caps), with exact figures and units as stated. Null if not found.",
  "permittingThresholds": "What triggers a permit requirement vs. an exempt well (e.g. wells under a certain gpm or horsepower, domestic/livestock use exemptions), with exact figures as stated. Null if not found.",
  "droughtRules": "Drought or curtailment stage triggers and what they require, if the plan covers this. Null if not found.",
  "confidence": "high, medium, or low — your confidence that the above is accurate and complete, given what's actually in this document",
  "notes": "Anything ambiguous, contradictory, or worth a human double-checking against the source before this is shown to the public. Null if none."
}`;

async function downloadPdfAsBase64(url) {
  const res = await fetchWithTimeout(url, {}, 30000);
  if (!res.ok) throw new Error(`PDF download responded with status ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.toString('base64');
}

function parseExtractionJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude's reply had no JSON object:\n${text.slice(0, 500)}`);
  return JSON.parse(match[0]);
}

async function run() {
  if (!isConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  for (const district of PILOT_DISTRICTS) {
    console.log(`\n=== ${district.districtName} ===`);
    // One retry on transient network failures — large sequential downloads/API
    // calls to two different hosts occasionally hit a transient connection
    // reset that a straight retry clears up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`  Downloading ${district.pdfUrl} ...`);
        const pdfBase64 = await downloadPdfAsBase64(district.pdfUrl);
        console.log(`  Downloaded (${Math.round((pdfBase64.length * 0.75) / 1024)} KB). Extracting (this can take a minute or two for a large scanned document) ...`);
        const replyText = await extractFromPdf({ pdfBase64, prompt: EXTRACTION_PROMPT });
        const extracted = parseExtractionJson(replyText);
        await upsertRestrictions({
          districtName: district.districtName,
          sourcePdfUrl: district.pdfUrl,
          planYear: district.planYear,
          ...extracted,
        });
        console.log(`  Saved. Confidence: ${extracted.confidence}`);
        break;
      } catch (err) {
        console.error(`  FAILED (attempt ${attempt}): ${err.message}`);
        if (err.cause) console.error(`  CAUSE: ${err.cause.message || err.cause}`);
        if (attempt === 2) console.error(`  Giving up on ${district.districtName} after 2 attempts.`);
      }
    }
    // Brief pacing gap between districts, not just within retries.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log('\nDone.');
  process.exit(0);
}

run();
