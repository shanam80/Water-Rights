// Follow-up to extractGcdRestrictions.js. That first pass pulled from each
// district's management PLAN, and for 4 of the 8 pilot districts the actual
// numeric spacing/production/permitting figures turned out to live in a
// separate district-published RULES document instead (the plan just
// referenced it). This script re-extracts those 4 districts from their real
// Rules document, replacing the earlier plan-derived (mostly-null) row.
// One-off/occasionally-rerun — NOT part of the live server.
// Run with: node server/scripts/extractGcdRulesFollowup.js
require('dotenv').config();
const mammoth = require('mammoth');
const { fetchWithTimeout } = require('../lib/http');
const { extractFromPdf, extractFromText, isConfigured } = require('../lib/anthropic');
const { upsertRestrictions } = require('../services/texas/gcdRestrictions');

const DISTRICTS = [
  {
    districtName: 'Glasscock GCD',
    rulesUrl: 'https://www.glasscock-groundwater.org/storage/UserFileFolder/Rules_&_ByLaws_Adopted_11-19-2023.docx',
    fileType: 'docx',
    planYear: 2023,
  },
  {
    districtName: 'Permian Basin UWCD',
    rulesUrl: 'https://www.pbuwcd.com/files/a57b9a588/2025+PBUWCD+Rules.pdf',
    fileType: 'pdf',
    planYear: 2025,
  },
  {
    districtName: 'Presidio County UWCD',
    rulesUrl: 'https://www.twdb.texas.gov/groundwater/docs/GCD/pcuwcd/pcuwcd_rules.pdf',
    fileType: 'pdf',
    planYear: null,
  },
  {
    districtName: 'South Plains UWCD',
    rulesUrl: 'https://spuwcd.org/wp-content/uploads/2018/10/2009_Rules.pdf',
    fileType: 'pdf',
    planYear: 2009,
  },
];

const EXTRACTION_PROMPT = `You are reading a Texas Groundwater Conservation District's RULES document (the legal document that actually sets numeric limits, as opposed to a broader management plan).

Extract ONLY what this document actually states. Do not infer, estimate, or fill in typical/default values. Reply with ONLY a single JSON object, no other text, in exactly this shape:

{
  "summary": "2-3 plain-language sentences a landowner would understand, summarizing the district's actual rules",
  "spacingRules": "Well spacing requirements (distances between wells, distance from property lines), with exact figures and units as stated. Null if not found.",
  "productionLimits": "Pumping/production limits (e.g. acre-feet per acre per year, gallons per minute caps), with exact figures and units as stated. Null if not found.",
  "permittingThresholds": "What triggers a permit requirement vs. an exempt well (e.g. wells under a certain gpm or horsepower, domestic/livestock use exemptions), with exact figures as stated. Null if not found.",
  "droughtRules": "Drought or curtailment stage triggers and what they require, if the rules cover this. Null if not found.",
  "confidence": "high, medium, or low — your confidence that the above is accurate and complete, given what's actually in this document",
  "notes": "Anything ambiguous, contradictory, or worth a human double-checking against the source before this is shown to the public. Null if none."
}`;

async function downloadBuffer(url) {
  const res = await fetchWithTimeout(url, {}, 30000);
  if (!res.ok) throw new Error(`Download responded with status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseExtractionJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude's reply had no JSON object:\n${text.slice(0, 500)}`);
  return JSON.parse(match[0]);
}

async function extractDistrict(district) {
  console.log(`  Downloading ${district.rulesUrl} ...`);
  const buffer = await downloadBuffer(district.rulesUrl);
  console.log(`  Downloaded (${Math.round(buffer.length / 1024)} KB). Extracting ...`);

  let replyText;
  if (district.fileType === 'docx') {
    const { value: documentText } = await mammoth.extractRawText({ buffer });
    replyText = await extractFromText({ documentText, prompt: EXTRACTION_PROMPT });
  } else {
    replyText = await extractFromPdf({ pdfBase64: buffer.toString('base64'), prompt: EXTRACTION_PROMPT });
  }

  const extracted = parseExtractionJson(replyText);
  await upsertRestrictions({
    districtName: district.districtName,
    sourcePdfUrl: district.rulesUrl,
    planYear: district.planYear,
    ...extracted,
  });
  console.log(`  Saved. Confidence: ${extracted.confidence}`);
}

async function run() {
  if (!isConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  for (const district of DISTRICTS) {
    console.log(`\n=== ${district.districtName} ===`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await extractDistrict(district);
        break;
      } catch (err) {
        console.error(`  FAILED (attempt ${attempt}): ${err.message}`);
        if (err.cause) console.error(`  CAUSE: ${err.cause.message || err.cause}`);
        if (attempt === 2) console.error(`  Giving up on ${district.districtName} after 2 attempts.`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log('\nDone.');
  process.exit(0);
}

run();
