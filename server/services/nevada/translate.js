// Nevada's water-rights data, from a live query against NDWR's ArcGIS
// services (confirmed live 2026-08-15 — the services catalog at
// arcgis.water.nv.gov/arcgis/rest/services is genuinely discoverable, no
// need to guess folder names). Points of Diversion and Places of Use
// share the exact same field schema, so one translate function covers
// both, same approach as Montana.
//
// `county` and `app_status` come back as short codes (e.g. "WA", "DEC")
// with no domain/lookup metadata exposed by the service itself. Only one
// mapping was verified live (WA = Washoe, cross-checked against a real
// Reno-area query) — not enough to safely decode the rest, so both fields
// are passed through as raw codes rather than guessed at, per the
// project's own rule against trusting unverified translations.
const { findVal, fmtDatePlain } = require('../../lib/fields');

function translateWaterRightFeature(feature, recordType) {
  const attrs = feature.attributes;
  const priorityRaw = findVal(attrs, ['priority_date']);

  const geometry = feature.geometry
    ? feature.geometry.rings
      ? { type: 'polygon', rings: feature.geometry.rings }
      : { type: 'point', lat: feature.geometry.y ?? findVal(attrs, ['latitude']), lon: feature.geometry.x ?? findVal(attrs, ['longitude']) }
    : (attrs.latitude != null && attrs.longitude != null ? { type: 'point', lat: attrs.latitude, lon: attrs.longitude } : null);

  return {
    recordType, // 'diversion' | 'placeOfUse'
    polyId: findVal(attrs, ['poly_id']), // shared boundary identifier — see waterRights.js for why this matters
    appNumber: findVal(attrs, ['app']),
    statusCode: findVal(attrs, ['app_status']),
    siteName: findVal(attrs, ['site_name']),
    basin: findVal(attrs, ['basin']),
    countyCode: findVal(attrs, ['county']),
    source: findVal(attrs, ['source_desc']) || findVal(attrs, ['source']),
    priorityDate: { raw: priorityRaw, plain: fmtDatePlain(priorityRaw) },
    dutyBalanceAF: findVal(attrs, ['duty_balance']),
    diversionBalanceCfs: findVal(attrs, ['diversion_balance']),
    diversionRateCfs: findVal(attrs, ['diversion_rate']),
    placeOfUseAcres: findVal(attrs, ['pou_acre_total']),
    decreeName: findVal(attrs, ['decree_name']),
    interbasinTransfer: findVal(attrs, ['interbasin_transfer']),
    meterRequired: findVal(attrs, ['meter_required']),
    officialRecordUrl: findVal(attrs, ['permit_record']),
    geometry,
    raw: attrs,
  };
}

module.exports = { translateWaterRightFeature };
