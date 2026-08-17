const { query } = require('../../db');

async function getRestrictionsByDistrictName(districtName) {
  if (!districtName) return null;
  const result = await query('SELECT * FROM gcd_restrictions WHERE district_name = $1', [districtName]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    districtName: row.district_name,
    sourcePdfUrl: row.source_pdf_url,
    planYear: row.plan_year,
    summary: row.summary,
    spacingRules: row.spacing_rules,
    productionLimits: row.production_limits,
    permittingThresholds: row.permitting_thresholds,
    droughtRules: row.drought_rules,
    confidence: row.extraction_confidence,
    notes: row.extraction_notes,
    extractedAt: row.extracted_at,
  };
}

async function upsertRestrictions(row) {
  await query(
    `INSERT INTO gcd_restrictions
      (district_name, source_pdf_url, plan_year, summary, spacing_rules, production_limits, permitting_thresholds, drought_rules, extraction_confidence, extraction_notes, extracted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (district_name) DO UPDATE SET
       source_pdf_url = EXCLUDED.source_pdf_url,
       plan_year = EXCLUDED.plan_year,
       summary = EXCLUDED.summary,
       spacing_rules = EXCLUDED.spacing_rules,
       production_limits = EXCLUDED.production_limits,
       permitting_thresholds = EXCLUDED.permitting_thresholds,
       drought_rules = EXCLUDED.drought_rules,
       extraction_confidence = EXCLUDED.extraction_confidence,
       extraction_notes = EXCLUDED.extraction_notes,
       extracted_at = now()`,
    [
      row.districtName,
      row.sourcePdfUrl,
      row.planYear || null,
      row.summary || null,
      row.spacingRules || null,
      row.productionLimits || null,
      row.permittingThresholds || null,
      row.droughtRules || null,
      row.confidence || null,
      row.notes || null,
    ]
  );
}

module.exports = { getRestrictionsByDistrictName, upsertRestrictions };
