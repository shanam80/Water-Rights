// Texas well log depth + metadata, cached from the Railroad Commission's
// monthly log inventory workbooks. See the well_log_inventory table comment
// in schema.sql for why this is a separate source from the map layer.
const { query } = require('../../db');

// Looks up cached depth/metadata for a batch of API numbers. Wells with no
// row simply don't appear in the result — the caller treats that as
// "unknown start depth", which is a real answer, not a failure.
async function getDepthsForApis(apis) {
  if (!Array.isArray(apis) || apis.length === 0) return {};
  const unique = [...new Set(apis.map((a) => String(a).trim()).filter(Boolean))].slice(0, 500);
  if (unique.length === 0) return {};

  const result = await query(
    `SELECT api, top_log_interval_ft, bottom_total_depth_ft, operator_name,
            lease_name, field_name, well_number, log_description, log_format, image_size
       FROM well_log_inventory
      WHERE api = ANY($1::text[])`,
    [unique]
  );

  const byApi = {};
  for (const row of result.rows) {
    byApi[row.api] = {
      topLogIntervalFt: row.top_log_interval_ft,
      bottomTotalDepthFt: row.bottom_total_depth_ft,
      operator: row.operator_name,
      leaseName: row.lease_name,
      fieldName: row.field_name,
      wellNumber: row.well_number,
      logDescription: row.log_description,
      logFormat: row.log_format,
      imageSize: row.image_size,
    };
  }
  return byApi;
}

async function upsertInventoryRow(row) {
  await query(
    `INSERT INTO well_log_inventory
       (api, top_log_interval_ft, bottom_total_depth_ft, operator_name, lease_name,
        field_name, well_number, county_name, log_description, document_date, source_file,
        log_format, image_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (api) DO UPDATE SET
       -- Keep whichever record actually carries a depth: a later scan with
       -- an unpopulated field shouldn't erase a known depth.
       top_log_interval_ft = COALESCE(EXCLUDED.top_log_interval_ft, well_log_inventory.top_log_interval_ft),
       bottom_total_depth_ft = COALESCE(EXCLUDED.bottom_total_depth_ft, well_log_inventory.bottom_total_depth_ft),
       operator_name = COALESCE(EXCLUDED.operator_name, well_log_inventory.operator_name),
       lease_name = COALESCE(EXCLUDED.lease_name, well_log_inventory.lease_name),
       field_name = COALESCE(EXCLUDED.field_name, well_log_inventory.field_name),
       well_number = COALESCE(EXCLUDED.well_number, well_log_inventory.well_number),
       county_name = COALESCE(EXCLUDED.county_name, well_log_inventory.county_name),
       log_description = COALESCE(EXCLUDED.log_description, well_log_inventory.log_description),
       document_date = COALESCE(EXCLUDED.document_date, well_log_inventory.document_date),
       log_format = COALESCE(EXCLUDED.log_format, well_log_inventory.log_format),
       image_size = COALESCE(EXCLUDED.image_size, well_log_inventory.image_size),
       source_file = EXCLUDED.source_file,
       ingested_at = now()`,
    [
      row.api, row.topLogIntervalFt, row.bottomTotalDepthFt, row.operatorName, row.leaseName,
      row.fieldName, row.wellNumber, row.countyName, row.logDescription, row.documentDate, row.sourceFile,
      row.logFormat, row.imageSize,
    ]
  );
}

async function countInventory() {
  const r = await query('SELECT COUNT(*) AS n, COUNT(top_log_interval_ft) AS with_depth FROM well_log_inventory');
  return { total: Number(r.rows[0].n), withDepth: Number(r.rows[0].with_depth) };
}

module.exports = { getDepthsForApis, upsertInventoryRow, countInventory };
