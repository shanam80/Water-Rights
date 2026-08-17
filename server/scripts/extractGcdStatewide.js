// Statewide follow-up to the West Texas pilot (extractGcdRestrictions.js).
// Covers the remaining ~90 Groundwater Conservation Districts not in that
// pilot. Same approach: read each district's current plan straight from
// TWDB's own directory pages (gcdinfo1/2/3.asp) or, where TWDB just links
// out, the district's own site — never a guessed code. district_name
// values are the exact strings the live GCD boundary service
// (services.twdb.texas.gov) returns, confirmed 2026-08-17 via a full
// where=1=1 query against that layer, not per-district coordinate lookups
// like the pilot used.
//
// Two entities returned by that layer are NOT groundwater conservation
// districts (subsidence districts, different regulatory structure) and are
// deliberately excluded: Fort Bend Subsidence District, Harris-Galveston
// Subsidence District. Edwards Aquifer Authority is also excluded — it's a
// GCD-like authority but operates under its own separate enabling
// legislation, not Water Code Chapter 36 like the rest of these.
//
// Two districts were caught as name-collision risks during research and
// deliberately double-checked: Colorado County GCD and Cow Creek GCD both
// abbreviate to "CCGCD" but are unrelated districts with different
// websites (ccgcd.net vs ccgcd.org) — search results conflated them, so
// both were verified against TWDB's own listing before use here.
//
// Run with: node server/scripts/extractGcdStatewide.js
require('dotenv').config();
const mammoth = require('mammoth');
const { fetchWithTimeout } = require('../lib/http');
const { extractFromPdf, extractFromText, isConfigured } = require('../lib/anthropic');
const { upsertRestrictions } = require('../services/texas/gcdRestrictions');

const TWDB = 'https://www.twdb.texas.gov';

const DISTRICTS = [
  { districtName: 'Bandera County RA & GWD', url: `${TWDB}/groundwater/docs/GCD/bcragwd/bcragwd_mgmt_plan2023.pdf` },
  { districtName: 'Barton Springs/Edwards Aquifer CD', url: `${TWDB}/groundwater/docs/GCD/bseacd/bseacd_mgmt_plan2022_amended.pdf` },
  { districtName: 'Bee GCD', url: `${TWDB}/groundwater/docs/GCD/bgcd/bgcd_mgmt_plan2024.pdf` },
  { districtName: 'Blanco-Pedernales GCD', url: `${TWDB}/groundwater/docs/GCD/bpgcd/bpgcd_mgmt_plan2019.pdf` },
  { districtName: 'Bluebonnet GCD', url: `${TWDB}/groundwater/docs/GCD/bbgcd/bbgcd_mgmt_plan2023.pdf` },
  { districtName: 'Brazoria County GCD', url: 'https://www.bcgroundwater.org/images/bcg/documents/2025/BCGCD_GMP_202505.pdf' },
  { districtName: 'Brazos Valley GCD', url: `${TWDB}/groundwater/docs/GCD/bvgcd/bvgcd_mgmt_plan2023.pdf` },
  { districtName: 'Brewster County GCD', url: `${TWDB}/groundwater/docs/GCD/brewcgcd/brewstercgcd_mgmt_plan2022.pdf` },
  { districtName: 'Brush Country GCD', url: `${TWDB}/groundwater/docs/GCD/brushgcd/brushgcd_mgmt_plan2022.pdf` },
  { districtName: 'Calhoun County GCD', url: `${TWDB}/groundwater/docs/GCD/ccgcd/ccgcd_mgmt_plan2023.pdf` },
  { districtName: 'Central Texas GCD', url: `${TWDB}/groundwater/docs/GCD/ctgcd/ctgcd_mgmt_plan_2022_amended.pdf` },
  { districtName: 'Clear Fork GCD', url: `${TWDB}/groundwater/docs/GCD/cfgcd/cfgcd_mgmt_plan2022.pdf` },
  { districtName: 'Clearwater UWCD', url: `${TWDB}/groundwater/docs/GCD/cuwcd/cuwcd_mgmt_plan2020.pdf` },
  { districtName: 'Coastal Bend GCD', url: `${TWDB}/groundwater/docs/GCD/cbgcd/cbgcd_mgmt_plan2020.pdf` },
  { districtName: 'Coastal Plains GCD', url: `${TWDB}/groundwater/docs/GCD/cpgcd/cpgcd_mgmt_plan2020.pdf` },
  { districtName: 'Coke County UWCD', url: `${TWDB}/groundwater/docs/GCD/ccuwcd/ccuwcd_mgmt_plan2019.pdf` },
  // Not ccgcd.org (that's Cow Creek GCD, a different district) — verified via TWDB's own "cocgcd" folder.
  { districtName: 'Colorado County GCD', url: `${TWDB}/groundwater/docs/GCD/cocgcd/cocgcd_mgmt_plan2020.pdf` },
  { districtName: 'Comal Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/comtrin/ctgcd_mgmt_plan2018.pdf` },
  { districtName: 'Corpus Christi ASRCD', url: `${TWDB}/groundwater/docs/GCD/ccasrcd/CCASRCDMgmtPlan2019.pdf` },
  // Not ccgcd.net (that's Colorado County GCD, a different district).
  { districtName: 'Cow Creek GCD', url: 'https://ccgcd.org/wp-content/uploads/2025/01/CCGCD_Management-Plan_2025_01_13_FINAL.pdf' },
  { districtName: 'Crockett County GCD', url: `${TWDB}/groundwater/docs/GCD/crockettcgcd/crockettcgcd_mgmt_plan2024.pdf` },
  { districtName: 'Culberson County GCD', url: `${TWDB}/groundwater/docs/GCD/culbersoncgcd/culbersoncgcd_mgmt_plan2021.pdf` },
  { districtName: 'Duval County GCD', url: `${TWDB}/groundwater/docs/GCD/dcgcd/dcgcd_mgmt_plan2023.pdf` },
  { districtName: 'Evergreen UWCD', url: `${TWDB}/groundwater/docs/GCD/euwcd/euwcd_mgmt_plan2021_amended.pdf` },
  { districtName: 'Fayette County GCD', url: `${TWDB}/groundwater/docs/GCD/fcgcd/fcgcd_mgmt_plan2024.pdf` },
  { districtName: 'Garza County UWCD', url: `${TWDB}/groundwater/docs/GCD/garzauwcd/garzauwcd_mgmt_plan2024.pdf` },
  { districtName: 'Gateway GCD', url: `${TWDB}/groundwater/docs/GCD/gatewaygcd/gatewaygcd_mgmt_plan2021.pdf` },
  { districtName: 'Goliad County GCD', url: `${TWDB}/groundwater/docs/GCD/goliadgcd/goliadgcd_mgmt_plan2023.pdf` },
  { districtName: 'Gonzales County UWCD', url: `${TWDB}/groundwater/docs/GCD/gcuwcd/gcuwcd_mgmt_plan2024.pdf` },
  { districtName: 'Guadalupe County GCD', url: `${TWDB}/groundwater/docs/GCD/gcgcd/gcgcd_mgmt_plan2022.pdf` },
  { districtName: 'Hays Trinity GCD', url: 'https://haysgroundwater.com/wp-content/uploads/2026-HTGCD-Mgmt-Plan_Final.pdf' },
  { districtName: 'Headwaters GCD', url: `${TWDB}/groundwater/docs/GCD/huwcd/hgcd_mgmt_plan2022_amended.pdf` },
  { districtName: 'Hemphill County UWCD', url: `${TWDB}/groundwater/docs/GCD/hcuwcd/hcuwcd_mgmt_plan2022_amended.pdf` },
  { districtName: 'Hickory UWCD #1', url: `${TWDB}/groundwater/docs/GCD/huwcd1/huwcd1_mgmt_plan2024.pdf` },
  { districtName: 'Hill Country UWCD', url: `${TWDB}/groundwater/docs/GCD/hilluwcd/hilluwcd_mgmt_plan2024.pdf` },
  { districtName: 'Hudspeth County UWCD #1', url: `${TWDB}/groundwater/docs/GCD/hcuwcd1/hcuwcd1_mgmt_plan2024.pdf` },
  { districtName: 'Irion County WCD', url: `${TWDB}/groundwater/docs/GCD/icwcd/icwcd_mgmt_plan2023.pdf` },
  { districtName: 'Jeff Davis County UWCD', url: `${TWDB}/groundwater/docs/GCD/jdcuwcd/jdcuwcd_mgmt_plan2024.pdf` },
  { districtName: 'Kenedy County GCD', url: `${TWDB}/groundwater/docs/GCD/kecgcd/kecgcd_mgmt_plan2023.pdf` },
  { districtName: 'Kimble County GCD', url: `${TWDB}/groundwater/docs/GCD/kimcgcd/kimcgcd_mgmt_plan2024.pdf` },
  { districtName: 'Kinney County GCD', url: `${TWDB}/groundwater/docs/GCD/kincgcd/kincgcd_mgmt_plan2018.pdf` },
  { districtName: 'Lipan-Kickapoo WCD', url: `${TWDB}/groundwater/docs/GCD/lkwcd/lkwcd_mgmt_plan2023.pdf` },
  { districtName: 'Live Oak UWCD', url: `${TWDB}/groundwater/docs/GCD/louwcd/louwcd_mgmt_plan2025.pdf` },
  { districtName: 'Llano Estacado UWCD', url: `${TWDB}/groundwater/docs/GCD/leuwcd/leuwcd_mgmt_plan2020_amended.pdf` },
  { districtName: 'Lone Star GCD', url: `${TWDB}/groundwater/docs/GCD/lsgcd/lsgcd_mgmt_plan2025.pdf` },
  { districtName: 'Lone Wolf GCD', url: 'https://lonewolfgwcd.org/wp-content/uploads/2025/11/LWGCD-Management-Plan-2025-2030-combined-2.pdf' },
  { districtName: 'Lost Pines GCD', url: `${TWDB}/groundwater/docs/GCD/lpgcd/lpgcd_mgmt_plan2023.pdf` },
  { districtName: 'Lower Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/ltgcd/ltgcd_mgmt_plan2019.pdf` },
  { districtName: 'McMullen GCD', url: `${TWDB}/groundwater/docs/GCD/mcmgcd/mcmgcd_mgmt_plan2024.pdf` },
  { districtName: 'Medina County GCD', url: `${TWDB}/groundwater/docs/GCD/mcgcd/mcgcd_mgmt_plan2022.pdf` },
  { districtName: 'Menard County UWD', url: `${TWDB}/groundwater/docs/GCD/mcuwd/mcuwd_mgmt_plan2022.pdf` },
  { districtName: 'Mesa UWCD', url: 'https://drive.google.com/uc?export=download&id=1UDhHMzGd_urNgRtjuPl5fs85wuNwfbbS', fileType: 'docx' },
  { districtName: 'Mesquite GCD', url: `${TWDB}/groundwater/docs/GCD/mgcd/mgcd_mgmt_plan2024.pdf` },
  { districtName: 'Mid-East Texas GCD', url: `${TWDB}/groundwater/docs/GCD/metgcd/metgcd_mgmt_plan2019.pdf` },
  { districtName: 'Middle Pecos GCD', url: 'https://www.middlepecosgcd.org/pdf/mgt_plan/2025/MPGCD%20Management%20Plan%20Final%20Submitted%202025.05.27.pdf' },
  { districtName: 'Middle Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/middletringcd/mtgcd_mgmtplan_2022_amended.PDF` },
  { districtName: 'Neches & Trinity Valleys GCD', url: `${TWDB}/groundwater/docs/GCD/ntvgcd/ntvgcd_mgmt_plan2025.pdf` },
  { districtName: 'North Texas GCD', url: `${TWDB}/groundwater/docs/GCD/northtexasgcd/northtexasgcd_mgmtplan_2022.pdf` },
  { districtName: 'Northern Trinity GCD', url: 'https://ntgcd.com/wp-content/uploads/2026/01/NorthernTrinityGCD-2025-FinalPlan-Complete.pdf' },
  { districtName: 'Panola County GCD', url: `${TWDB}/groundwater/docs/GCD/pcgcd/pcgcd_mgmt_plan2023.pdf` },
  { districtName: 'Pecan Valley GCD', url: `${TWDB}/groundwater/docs/GCD/pvgcd/pvgcd_mgmt_plan2024.pdf` },
  { districtName: 'Pineywoods GCD', url: `${TWDB}/groundwater/docs/GCD/pwgcd/pwgcd_mgmt_plan2023.pdf` },
  { districtName: 'Plateau UWC & SD', url: `${TWDB}/groundwater/docs/GCD/puwcsd/puwcsd_mgmt_plan2024.pdf` },
  { districtName: 'Plum Creek CD', url: `${TWDB}/groundwater/docs/GCD/pccd/pccd_mgmt_plan2023_amended.PDF` },
  { districtName: 'Post Oak Savannah GCD', url: `${TWDB}/groundwater/docs/GCD/posgcd/posgcd_mgmt_plan2022_amended.pdf` },
  { districtName: 'Prairielands GCD', url: 'https://www.prairielandsgcd.org/wp-content/uploads/2024/03/PrairielandsGCD_ManagementPlanUpdate_FINAL_2024-03-26.pdf' },
  { districtName: 'Real-Edwards C & RD', url: `${TWDB}/groundwater/docs/GCD/recrd/recrd_mgmt_plan2020.pdf` },
  { districtName: 'Red River GCD', url: `${TWDB}/groundwater/docs/GCD/rrgcd/rrgcd_mgmtplan_2022.pdf` },
  { districtName: 'Red Sands GCD', url: `${TWDB}/groundwater/docs/GCD/rsgcd/rsgcd_mgmt_plan2023.pdf` },
  { districtName: 'Refugio GCD', url: `${TWDB}/groundwater/docs/GCD/rgcd/rgcd_mgmt_plan2023.pdf` },
  { districtName: 'Rolling Plains GCD', url: 'https://rollingplainsgcd.gov/wp-content/uploads/2025/05/RPGCD-GW-Management-Plan-20250515.pdf' },
  { districtName: 'Rusk County GCD', url: `${TWDB}/groundwater/docs/GCD/rcgcd/rcgcd_mgmt_plan2023.pdf` },
  { districtName: 'San Patricio County GCD', url: `${TWDB}/groundwater/docs/GCD/spcgcd/spcgcd_mgmtplan_2022_amended.pdf` },
  { districtName: 'Sandy Land UWCD', url: `${TWDB}/groundwater/docs/GCD/sluwcd/sluwcd_mgmt_plan2024.pdf` },
  { districtName: 'Santa Rita UWCD', url: 'https://www.santaritauwcd.org/files/3ad98215d/SRUWCD+Mangement+Plan+25-30.pdf' },
  { districtName: 'Saratoga UWCD', url: `${TWDB}/groundwater/docs/GCD/suwcd/suwcd_mgmt_plan2025.pdf` },
  { districtName: 'Southeast Texas GCD', url: `${TWDB}/groundwater/docs/GCD/setgcd/setgcd_mgmt_plan2022_amended.pdf` },
  { districtName: 'Southern Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/stgcd/stgcd_mgmt_plan2021.pdf` },
  { districtName: 'Southwestern Travis County GCD', url: 'https://img1.wsimg.com/blobby/go/d8f57d03-09f5-431d-8d73-0651791a659b/downloads/9ec38844-c04b-4f02-bff8-645d8b82ab47/SWTCGCD-Management-Plan_Approved-20250815.pdf' },
  { districtName: 'Starr County GCD', url: `${TWDB}/groundwater/docs/GCD/scgcd/scgcd_mgmt_plan2021.pdf` },
  { districtName: 'Sterling County UWCD', url: `${TWDB}/groundwater/docs/GCD/stcuwcd/stcuwcd_mgmt_plan2023.pdf` },
  { districtName: 'Sutton County UWCD', url: `${TWDB}/groundwater/docs/GCD/sucuwcd/sucuwcd_mgmt_plan2024.pdf` },
  { districtName: 'Terrell County GCD', url: `${TWDB}/groundwater/docs/GCD/tcgcd/tcgcd_mgmt_plan2023.pdf` },
  { districtName: 'Texana GCD', url: `${TWDB}/groundwater/docs/GCD/tgcd/tgcd_mgmt_plan2023.pdf` },
  { districtName: 'Trinity Glen Rose GCD', url: 'https://www.trinityglenrose.com/_files/ugd/4383d6_6c5df845dcfd46c99a5ecfc230055b24.pdf' },
  { districtName: 'Upper Trinity GCD', url: `${TWDB}/groundwater/docs/GCD/utgcd/utgcd_mgmt_plan2020.pdf` },
  { districtName: 'Uvalde County UWCD', url: `${TWDB}/groundwater/docs/GCD/ucuwcd/ucuwcd_mgmt_plan2021.pdf` },
  { districtName: 'Victoria County GCD', url: `${TWDB}/groundwater/docs/GCD/vcgcd/vcgcd_mgmt_plan2023.pdf` },
  { districtName: 'Wes-Tex GCD', url: `${TWDB}/groundwater/docs/GCD/westexgcd/westexgcd_mgmtplan_2020.pdf` },
  { districtName: 'Wintergarden GCD', url: `${TWDB}/groundwater/docs/GCD/wgcd/wgcd_mgmt_plan2016.pdf` },
];

const EXTRACTION_PROMPT = `You are reading a Texas Groundwater Conservation District's official document — either its management plan or its rules, whichever this is (a legal/regulatory document, possibly a scanned PDF with no text layer — read the page images directly).

Extract ONLY what this document actually states. Do not infer, estimate, or fill in typical/default values. If the specific numbers aren't in this document but it references a separate Rules document, say so in "notes" and include the URL if given. Reply with ONLY a single JSON object, no other text, in exactly this shape:

{
  "summary": "2-3 plain-language sentences a landowner would understand, summarizing the district's approach to regulating groundwater use",
  "spacingRules": "Well spacing requirements (distances between wells, distance from property lines), with exact figures and units as stated. Null if not found.",
  "productionLimits": "Pumping/production limits (e.g. acre-feet per acre per year, gallons per minute caps), with exact figures and units as stated. Null if not found.",
  "permittingThresholds": "What triggers a permit requirement vs. an exempt well (e.g. wells under a certain gpm or horsepower, domestic/livestock use exemptions), with exact figures as stated. Null if not found.",
  "droughtRules": "Drought or curtailment stage triggers and what they require, if covered. Null if not found.",
  "confidence": "high, medium, or low — your confidence that the above is accurate and complete, given what's actually in this document",
  "notes": "Anything ambiguous, contradictory, or worth a human double-checking against the source before this is shown to the public — including a pointer to a separate Rules document if this one doesn't have the numbers. Null if none."
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
  console.log(`  Downloading ${district.url} ...`);
  const buffer = await downloadBuffer(district.url);
  console.log(`  Downloaded (${Math.round(buffer.length / 1024)} KB). Extracting ...`);

  let replyText;
  if (district.fileType === 'docx') {
    const { value: documentText } = await mammoth.extractRawText({ buffer });
    replyText = await extractFromText({ documentText, prompt: EXTRACTION_PROMPT });
  } else {
    replyText = await extractFromPdf({ pdfBase64: buffer.toString('base64'), prompt: EXTRACTION_PROMPT });
  }

  const extracted = parseExtractionJson(replyText);
  await upsertRestrictions({ districtName: district.districtName, sourcePdfUrl: district.url, planYear: null, ...extracted });
  console.log(`  Saved. Confidence: ${extracted.confidence}`);
}

async function run() {
  if (!isConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  console.log(`Running ${DISTRICTS.length} districts.\n`);
  const failures = [];

  for (const district of DISTRICTS) {
    console.log(`\n=== ${district.districtName} ===`);
    let succeeded = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await extractDistrict(district);
        succeeded = true;
        break;
      } catch (err) {
        console.error(`  FAILED (attempt ${attempt}): ${err.message}`);
        if (err.cause) console.error(`  CAUSE: ${err.cause.message || err.cause}`);
      }
    }
    if (!succeeded) {
      console.error(`  Giving up on ${district.districtName} after 2 attempts.`);
      failures.push(district.districtName);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log(`\nDone. ${DISTRICTS.length - failures.length}/${DISTRICTS.length} succeeded.`);
  if (failures.length > 0) console.log('Failed:', failures.join(', '));
  process.exit(0);
}

run();
