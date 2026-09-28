// Curtailment / restriction risk, outside Colorado.
//
// Colorado publishes live administrative calls, so its curtailment status
// is computable exactly (see services/colorado/calls.js). No other state
// here publishes a live call feed. What several DO publish is the
// administrative status of the ground you're standing on — whether the
// basin is closed, critical, under a moratorium, or actively distributed
// by a watermaster. That's the same class of signal WaterMap NM flags, and
// it's the honest answer where a live call feed doesn't exist.
//
// Everything below was verified live 2026-09-03, including a positive
// match inside a real area rather than only an empty result.
const { fetchWithTimeout } = require('../lib/http');
const { TtlCache } = require('../lib/cache');

// Boundaries change rarely; a day is plenty and keeps repeat searches free.
const cache = new TtlCache();
const TTL_MS = 24 * 60 * 60 * 1000;

const IDWR = 'https://gis.idwr.idaho.gov/hosting/rest/services/Regulatory';
const NDWR = 'https://arcgis.water.nv.gov/arcgis/rest/services/NDWR';

// Idaho: four separate layers, each a different kind of restriction.
// Counts confirmed statewide — 8 critical areas, 14 management areas,
// 8 moratorium areas — so an empty result is a real "not here", not a
// broken query.
const IDAHO_LAYERS = [
  {
    url: `${IDWR}/CriticalGroundwaterAreas/MapServer/0`,
    field: 'NAME',
    kind: 'Critical Ground Water Area',
    severity: 'high',
    note: 'Groundwater here is over-appropriated — withdrawals exceed the recharge the aquifer can sustain. New appropriations are restricted, and existing junior rights can be curtailed in a shortage.',
  },
  {
    url: `${IDWR}/GroundwaterManagementAreas/MapServer/0`,
    field: 'NAME',
    kind: 'Ground Water Management Area',
    severity: 'medium',
    note: 'IDWR has determined this aquifer may be approaching the point where withdrawals exceed recharge. It is actively managed, and restrictions can tighten.',
  },
  {
    url: `${IDWR}/MoratoriumAreas/MapServer/0`,
    field: 'NAME',
    kind: 'Moratorium Area',
    severity: 'high',
    note: 'New water right applications are not being accepted here.',
  },
  {
    url: `${IDWR}/WaterDistricts/MapServer/0`,
    field: 'DISTAME',
    extraFields: 'DISTRICT,STATUS',
    kind: 'Water District',
    severity: 'info',
    note: 'A watermaster distributes water here by priority date, which is the mechanism by which junior rights actually get shut off in a shortage.',
  },
];

async function queryPoint(layerUrl, lat, lon, outFields) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields,
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetchWithTimeout(`${layerUrl}/query?${params.toString()}`, {}, 20000);
  if (!res.ok) throw new Error(`Administrative layer responded with status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Administrative layer returned an error.');
  return data.features || [];
}

async function idahoAreas(lat, lon) {
  const results = await Promise.all(
    IDAHO_LAYERS.map(async (layer) => {
      try {
        const fields = layer.extraFields ? `${layer.field},${layer.extraFields}` : layer.field;
        const features = await queryPoint(layer.url, lat, lon, fields);
        return features.map((f) => ({
          kind: layer.kind,
          name: f.attributes[layer.field] || null,
          severity: layer.severity,
          note: layer.note,
          detail: f.attributes.STATUS ? `Status: ${f.attributes.STATUS}` : null,
        }));
      } catch (err) {
        // One layer being down shouldn't hide the other three.
        console.error(`Idaho ${layer.kind} lookup failed:`, err.message);
        return [];
      }
    })
  );
  return results.flat();
}

// Nevada: one layer covering every basin, carrying whether the State
// Engineer has designated it and a link to the actual order.
//
// The status codes in use are D, ID, PU and PUID (plus null). "D" is
// designated and "PU" is a preferred-use order under NRS 534.120; ID and
// PUID could not be confirmed against an authoritative source, so they're
// shown as-is rather than guessed at — basin designation carries legal
// weight and a plausible-sounding wrong expansion would be worse than an
// honest abbreviation. The DesignatedBasin field is unambiguous either
// way, so that carries the message.
async function nevadaAreas(lat, lon) {
  try {
    const features = await queryPoint(
      `${NDWR}/Basins_State_Engineer_Designation_Orders/MapServer/0`,
      lat,
      lon,
      'BasinName,BasinID,DesignationStatus,DesignationOrder,DesignationOrderLink,DesignatedBasin'
    );
    return features
      .filter((f) => String(f.attributes.DesignatedBasin || '').toLowerCase() === 'yes')
      .map((f) => {
        const a = f.attributes;
        const order = String(a.DesignationOrder || '').trim();
        return {
          kind: 'Designated Basin',
          name: a.BasinName ? `${a.BasinName.trim()}${a.BasinID ? ` (Basin ${String(a.BasinID).trim()})` : ''}` : null,
          severity: 'high',
          note:
            'The State Engineer has designated this basin, meaning permitted rights approach or exceed the average annual recharge. In a designated basin the State Engineer can restrict new appropriations, set preferred uses, and prohibit new domestic wells where a public supplier already serves the area.',
          detail: [
            order ? `Order ${order}` : null,
            a.DesignationStatus ? `Status code ${String(a.DesignationStatus).trim()}` : null,
          ].filter(Boolean).join(' · ') || null,
          documentUrl: a.DesignationOrderLink || null,
        };
      });
  } catch (err) {
    console.error('Nevada designation lookup failed:', err.message);
    return [];
  }
}

// Utah: three separate layers, because Utah splits the job three ways.
//
// A caution learned the hard way here. Utah's policy layer advertises a
// RESTRICTED field, plus AFLIMIT, DOM, IRRIG, STOCK and COMMENTS — exactly
// the columns you would want. Every one of them is empty: 0 of 211 records
// populated, checked 2026-09-28. Wiring up a field named RESTRICTED would
// have produced a confident blank where a real restriction might exist.
// Only AREA_CODE, NAME and DESCRIPT carry data, so only those are used.
//
// What Utah does publish is the appropriation policy per area, as a web
// page per area rather than as an attribute. So the honest thing is to
// name the area, name the office that administers it, and link Utah's own
// policy page — not to invent an open/closed verdict. Those pages are
// prose, and area 57 shows why a single verdict would be wrong: its
// surface water is fully appropriated, its groundwater sits under a
// management plan, and a 2022 Governor's proclamation applies on top.
const UTAH = 'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services';

const MONTANA = 'https://services2.arcgis.com/DRQySz3VhPgOv7Bo/arcgis/rest/services';

// Wyoming's parcel host also carries county boundaries, which is what the
// control-area flag below is built on.
const WYOMING_COUNTIES =
  'https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/County_Boundaries/FeatureServer/0';

// These layers pad unused text with a single space rather than leaving it
// null, the same habit New Mexico's OSE data has.
function clean(value) {
  const s = String(value == null ? '' : value).trim();
  return s === '' ? null : s;
}

async function utahAreas(lat, lon) {
  const [areas, policies, concerns] = await Promise.all([
    queryPoint(`${UTAH}/Utah_Water_Right_Areas/FeatureServer/0`, lat, lon, 'AREA_CODE,Office,Link')
      .catch((err) => { console.error('Utah water right area lookup failed:', err.message); return []; }),
    queryPoint(`${UTAH}/PolicyServiceView/FeatureServer/0`, lat, lon, 'AREA_CODE,NAME,DESCRIPT')
      .catch((err) => { console.error('Utah policy area lookup failed:', err.message); return []; }),
    queryPoint(`${UTAH}/AreasOfConcernView/FeatureServer/0`, lat, lon, 'NAME')
      .catch((err) => { console.error('Utah area of concern lookup failed:', err.message); return []; }),
  ]);

  const out = [];

  // Some places appear in both layers under the same name — Hill Air Force
  // Base is in the policy layer as "Restricted Area" and again as an area
  // of concern. Listing it twice reads like two separate findings, so the
  // policy entry gives way below to the more specific one.
  const concernNames = new Set(
    concerns.map((f) => (clean(f.attributes.NAME) || '').toLowerCase()).filter(Boolean)
  );

  for (const f of areas) {
    const a = f.attributes;
    const code = clean(a.AREA_CODE);
    const link = clean(a.Link);
    out.push({
      kind: 'Water Right Area',
      name: code ? `Area ${code}` : null,
      severity: 'info',
      note:
        'Utah sets appropriation policy area by area rather than publishing one statewide restriction map. The policy page for this area states whether its surface water and groundwater are open, fully appropriated, or closed to new appropriations, and many areas are closed. Read it before assuming water is available here.',
      detail: clean(a.Office),
      // Stored as http; the site redirects to https anyway, and an http
      // link from an https page is worth avoiding.
      documentUrl: link ? link.replace(/^http:/i, 'https:') : null,
      documentLabel: 'Read this area’s policy',
    });
  }

  for (const f of policies) {
    const a = f.attributes;
    const name = clean(a.NAME);
    const descript = clean(a.DESCRIPT);
    if (!name && !descript) continue;
    if (name && concernNames.has(name.toLowerCase())) continue;
    out.push({
      kind: 'Local Policy Area',
      name,
      severity: 'medium',
      note:
        'A local policy applies to this specific spot on top of the area-wide policy. These are the named sub-areas — a particular creek, wash, valley or management-plan boundary — where the State Engineer applies different terms than the rest of the area.',
      detail: descript,
    });
  }

  for (const f of concerns) {
    out.push({
      kind: 'Area of Concern',
      name: clean(f.attributes.NAME),
      severity: 'high',
      note:
        'Utah flags this ground for extra scrutiny on water right applications. The reasons differ by area and include groundwater contamination and remediation sites, military and industrial facilities, national monuments, and tribal lands. Check with the Division of Water Rights before planning a well here.',
    });
  }

  return out;
}

// Montana: enforcement areas are the real curtailment signal, and basin
// decree stage is the context that makes them meaningful.
//
// An enforcement area is where a water commissioner actually distributes
// water by priority under a district court order — the mechanism by which
// a junior right gets shut off. 91 areas statewide, every one carrying a
// status, verified 2026-09-28 against a positive match inside E030 Lower
// Willow Creek rather than only an empty result.
async function montanaAreas(lat, lon) {
  const [enforcement, basins] = await Promise.all([
    queryPoint(
      `${MONTANA}/Enforcement_Area_Shapes/FeatureServer/0`,
      lat, lon,
      'EnforcementArea,Description,F_Status,Basin,County,Source,DNRC_URL'
    ).catch((err) => { console.error('Montana enforcement lookup failed:', err.message); return []; }),
    queryPoint(
      `${MONTANA}/Basin_Boundaries/FeatureServer/0`,
      lat, lon,
      'BASINNUM,BASINNAME,DECREE'
    ).catch((err) => { console.error('Montana basin lookup failed:', err.message); return []; }),
  ]);

  const out = [];

  for (const f of enforcement) {
    const a = f.attributes;
    const status = clean(a.F_Status) || '';
    const active = /^active/i.test(status);
    const county = clean(a.County);
    const basin = clean(a.Basin);
    out.push({
      kind: 'Water Commissioner Enforcement Area',
      name: clean(a.EnforcementArea),
      severity: active ? 'high' : 'info',
      note: active
        ? 'A water commissioner distributes water here by priority date under a district court order. This is the mechanism by which junior rights actually get shut off in a shortage, so a junior right in this area can expect to be regulated in a dry year.'
        : 'DNRC has a water distribution project on record for this area, but it is not currently listed as active. It can be reactivated, which is why it is worth knowing about.',
      detail: [
        clean(a.Source),
        county ? `${county} County` : null,
        basin ? `Basin ${basin}` : null,
        status ? `Status: ${status}` : null,
      ].filter(Boolean).join(' · ') || null,
      documentUrl: clean(a.DNRC_URL),
      documentLabel: 'DNRC project page',
    });
  }

  for (const f of basins) {
    const a = f.attributes;
    const decree = clean(a.DECREE);
    // The basins nest — a point returns both its sub-basin and its parent,
    // and the parent's decree stage is stored as a single space. A blank
    // stage is not information, so it isn't shown.
    if (!decree) continue;
    const name = clean(a.BASINNAME);
    const num = clean(a.BASINNUM);
    out.push({
      kind: 'Adjudication Basin',
      name: name ? (num ? `${name} (Basin ${num})` : name) : (num ? `Basin ${num}` : null),
      severity: 'info',
      note:
        'Montana is still adjudicating its pre-1973 water rights, and the stage a basin has reached decides how settled the rights in it are. A final decree means the rights here are determined and enforceable by priority; a temporary or preliminary decree means claims are still open to objection and the picture can still change.',
      detail: `Decree stage: ${decree}`,
    });
  }

  return out;
}

// Wyoming: flagged by county, and the reason why is worth stating plainly.
//
// The State Engineer designates exactly three groundwater control areas in
// the whole state and — checked 2026-09-28 — publishes no boundary data for
// any of them. Their extent is given only as a fraction of a county in
// prose, alongside a static map image. There is no layer to query, and no
// honest way to do point-in-polygon from that.
//
// So this flags the county and says so. A county flag over-reports: someone
// in western Laramie County is probably outside the control area. That is
// the right direction to be wrong in, as long as it is labelled, because
// the alternative is staying silent about a permitting restriction that
// governs most of the county.
const WYOMING_CONTROL_AREAS = {
  Laramie: {
    name: 'Laramie County Control Area',
    extent: 'generally the eastern three-quarters of Laramie County',
    established: 'September 2, 1981',
  },
  Platte: {
    name: 'Platte County Control Area',
    extent: 'generally the middle half of Platte County',
    established: 'February 1, 1982',
  },
  Goshen: {
    name: 'Prairie Center Control Area',
    extent: 'generally the northeast eighth of Goshen County',
    established: 'December 2, 1977',
  },
};

const WYOMING_SEO_URL = 'https://seo.wyo.gov/ground-water/control-areas-and-advisory-boards';

async function wyomingAreas(lat, lon) {
  let county = null;
  try {
    const features = await queryPoint(WYOMING_COUNTIES, lat, lon, 'COUNTY');
    const first = features[0];
    county = first && first.attributes ? clean(first.attributes.COUNTY) : null;
  } catch (err) {
    console.error('Wyoming county lookup failed:', err.message);
    return [];
  }

  const area = county ? WYOMING_CONTROL_AREAS[county] : null;

  if (!area) {
    // Not the generic "nothing found" message, because that one says the
    // state's own boundary layers were checked. For Wyoming there are none.
    return [{
      kind: 'Groundwater Control Areas',
      name: county ? `${county} County` : null,
      severity: 'info',
      note:
        'Wyoming designates only three groundwater control areas statewide, and none of them covers this county. The State Engineer does not publish their boundaries as map data, so this is a county-level check rather than a precise one.',
      documentUrl: WYOMING_SEO_URL,
      documentLabel: 'Wyoming SEO control areas',
    }];
  }

  return [{
    kind: 'Possible Groundwater Control Area',
    name: area.name,
    severity: 'medium',
    note:
      `This point is in ${county} County, which contains the ${area.name} (${area.extent}, established ${area.established}). Inside a control area the State Engineer can limit new wells and regulate existing ones. The State Engineer does not publish the boundary as map data, so AcreFoot cannot tell you whether this exact spot falls inside it — confirm with the Ground Water Division before planning a well.`,
    detail: 'Boundary not published as map data · county-level flag',
    documentUrl: WYOMING_SEO_URL,
    documentLabel: 'Wyoming SEO control areas',
  }];
}

const SOURCES = {
  ID: idahoAreas,
  NV: nevadaAreas,
  UT: utahAreas,
  MT: montanaAreas,
  WY: wyomingAreas,
};

// Returns [] when the state has no researched source, rather than implying
// "no restrictions here" for a state we simply haven't looked at.
async function getAdministrativeAreas(state, lat, lon) {
  const fn = SOURCES[String(state || '').toUpperCase()];
  if (!fn) return { supported: false, areas: [] };

  const key = `${state}:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const areas = await fn(lat, lon);
  const result = { supported: true, areas };
  cache.set(key, result, TTL_MS);
  return result;
}

module.exports = { getAdministrativeAreas };
