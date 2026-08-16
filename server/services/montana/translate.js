// Montana's water-rights data, ported from a live query against
// gis.dnrc.mt.gov's WRQS FeatureServer (confirmed live 2026-08-15 — see
// docs/project-briefing.md §7 for how this was found). Points of Diversion
// (layer 1), Places of Use (layer 2), and Reservoirs (layer 3) share
// almost the same field schema, so one translate function covers all
// three rather than duplicating it per layer.
const { findVal, fmtDatePlain } = require('../../lib/fields');

function translateWaterRightFeature(feature, recordType) {
  const attrs = feature.attributes;
  const priorityRaw = findVal(attrs, ['ENF_PRTY_DT_DATE']);

  const geometry = feature.geometry
    ? feature.geometry.rings
      ? { type: 'polygon', rings: feature.geometry.rings }
      : { type: 'point', lat: feature.geometry.y, lon: feature.geometry.x }
    : null;

  return {
    recordType, // 'diversion' | 'placeOfUse' | 'reservoir'
    wrNumber: findVal(attrs, ['WR_NUMBER']),
    wrType: findVal(attrs, ['WR_TYPE']),
    status: findVal(attrs, ['WR_STATUS']),
    owners: findVal(attrs, ['OWNERS']),
    purpose: findVal(attrs, ['PURPOSES', 'PURPOSE']),
    priorityDate: { raw: priorityRaw, plain: fmtDatePlain(priorityRaw) || findVal(attrs, ['ENF_PRTY_DT_CHAR']) },
    source: [findVal(attrs, ['SOURCE_TYPE']), findVal(attrs, ['SOURCE_NAME'])].filter(Boolean).join(' — ') || null,
    meansOfDiversion: findVal(attrs, ['MEANS_OF_DIV']),
    ditch: findVal(attrs, ['DITCH']),
    wellDepthFt: findVal(attrs, ['WELL_DEPTH']),
    reservoirName: findVal(attrs, ['RESV_NAME']),
    reservoirType: findVal(attrs, ['RESV_TYPE']),
    reservoirCapacityAF: findVal(attrs, ['RESV_CURR_CAP']),
    reservoirSurfaceAcres: findVal(attrs, ['RESV_SRF_AREA']),
    reservoirDamHeightFt: findVal(attrs, ['RESV_DAM_HT']),
    irrigationType: findVal(attrs, ['IRR_TYPE']),
    acreage: findVal(attrs, ['ACREAGE']),
    maxFlow: findVal(attrs, ['MAX_FLOW']),
    maxVolumeAF: findVal(attrs, ['MAX_VOL']),
    maxAcres: findVal(attrs, ['MAX_ACRES']),
    maxFlowCfs: findVal(attrs, ['MAX_FLOW_CFS']),
    legalLocation: findVal(attrs, ['TRS_QQQQ']),
    county: findVal(attrs, ['COUNTY']),
    officialRecordUrl: findVal(attrs, ['URL_ABSTRACT']),
    scannedDocsUrl: findVal(attrs, ['URL_SCAN']),
    geometry,
    raw: attrs,
  };
}

module.exports = { translateWaterRightFeature };
