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

const SOURCES = { ID: idahoAreas, NV: nevadaAreas };

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
