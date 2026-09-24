// Turns an OSE Points of Diversion record into plain language.
//
// Field names and code meanings come from OSE's own published data
// dictionary (see codes.js), so this is the one state in the project where
// the translation layer didn't need a guess-test-fix cycle.
const codes = require('./codes');

// OSE pads unused text fields with a single space rather than leaving them
// null, so " " has to be treated as empty or the UI fills with blanks.
function clean(value) {
  const s = String(value == null ? '' : value).trim();
  return s === '' ? null : s;
}

// A depth or level of 0 means "not recorded", not "at the surface" — the
// same trap as Idaho's production rate and Texas's log intervals. Shown as
// unknown rather than as a misleading zero.
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// OSE dates arrive as epoch milliseconds from the feature service.
function formatDate(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // Placeholder years appear in this data the way 9999 does in Idaho's.
  if (year < 1600 || year > 2100) return null;
  return {
    plain: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    iso: d.toISOString().slice(0, 10),
  };
}

// OSE uses "0" where a coded lookup doesn't apply, rather than leaving the
// column empty. Its code tables are numbered from 1, so a zero is an absence
// and must not be echoed back as a value.
function isNoneCode(value) {
  const s = String(value == null ? '' : value).trim();
  return s === '' || s === '0';
}

function ownerName(a) {
  const last = clean(a.own_lname);
  const first = clean(a.own_fname);
  if (last && first) return `${first} ${last}`;
  return last || first || null;
}

// The file number is how a New Mexico water right is actually referred to —
// basin prefix, number, optional suffix (e.g. RG-00872).
function fileNumber(a) {
  const direct = clean(a.pod_file);
  if (direct) return direct;
  const basin = clean(a.pod_basin);
  const nbr = clean(a.pod_nbr);
  if (!basin || !nbr) return null;
  const suffix = clean(a.pod_suffix);
  return `${basin}-${nbr}${suffix ? '-' + suffix : ''}`;
}

function translatePod(feature) {
  const a = feature.attributes || {};
  const geom = feature.geometry || {};

  return {
    // Identity
    fileNumber: fileNumber(a),
    podRecordNumber: a.pod_rec_nb ?? null,
    podName: clean(a.pod_name),
    basin: codes.label(codes.BASIN_CODES, a.pod_basin),
    basinCode: clean(a.pod_basin),

    // Who
    owner: ownerName(a),
    ownerCity: clean(a.city),
    ownerState: clean(a.state),

    // What kind of right, and its standing
    status: codes.label(codes.STATUS_CODES, a.status),
    statusCode: clean(a.status),
    podStatus: codes.label(codes.POD_STATUS_CODES, a.pod_status),
    use: codes.label(codes.USE_CODES, a.use_),
    useCode: clean(a.use_),

    // Where
    county: codes.label(codes.COUNTY_CODES, a.county),
    legalLocation: clean(a.legal),
    township: clean(a.tws),
    range: clean(a.rng),
    section: clean(a.sec),

    // The well itself, where recorded
    wellDepthFt: positiveNumber(a.depth_well),
    waterDepthFt: positiveNumber(a.depth_wate),
    staticLevelFt: positiveNumber(a.static_lev),
    casingSizeIn: positiveNumber(a.casing_siz),
    dischargeGpm: positiveNumber(a.discharge),
    pumpType: codes.label(codes.PUMP_TYPE_CODES, a.pump_type),
    groundwaterSource: codes.label(codes.GW_SOURCE_CODES, a.grnd_wtr_s),
    // The surface-source table is numbered from 1, so a stored 0 means
    // "no surface source" — which is normal on a groundwater well. Passed
    // through the plain labeller it rendered as a literal "0", which is
    // noise rather than information.
    surfaceSource: isNoneCode(a.surface_co) ? null : codes.label(codes.SURFACE_SOURCE_CODES, a.surface_co),
    aquifer: clean(a.aquifer),
    elevationFt: positiveNumber(a.elevation),

    // Amounts
    totalDiversionAF: positiveNumber(a.total_div),
    startCfs: positiveNumber(a.cfs_start_),

    // Dates
    startDate: formatDate(a.start_date),
    finishDate: formatDate(a.finish_dat),
    plugDate: formatDate(a.plug_date),

    // The official record. OSE ships a complete NMWRRS deep link in the
    // data itself, so no URL had to be reverse-engineered for this state.
    officialRecordUrl: clean(a.nmwrrs_wrs),

    metered: clean(a.metered),
    location: geom.y != null && geom.x != null ? { lat: geom.y, lon: geom.x } : null,
    raw: a,
  };
}

module.exports = { translatePod };
