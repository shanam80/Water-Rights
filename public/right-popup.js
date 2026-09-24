// Shared map-popup renderer for water rights.
//
// Colorado already had a rich popup; the other five states showed only a
// name, an identifier and a distance. That's thin when the map is the whole
// screen — the point of expanding it is not having to leave it to read
// something.
//
// Field names differ per state because each agency's data does, so the
// mapping is declared per state rather than guessed. Every name below was
// read off a live response, not assumed.
(function () {
  // Ordered most-useful-first; anything missing is simply skipped.
  const FIELDS = {
    ID: [
      ['Status', 'status'], ['Priority', 'priorityDate'], ['Use', 'use'],
      ['Acres', 'totalAcres'], ['Source', 'source'], ['Tributary of', 'tributaryOf'],
      ['Basis', 'basis'],
    ],
    UT: [
      ['Status', 'status'], ['Type', 'type'], ['Priority', 'priorityDate'],
      ['Flow', 'cfs', ' cfs'], ['Volume', 'acreFeet', ' acre-feet'],
      ['Use', 'use'], ['Source', 'source'],
    ],
    MT: [
      ['Status', 'status'], ['Type', 'wrType'], ['Purpose', 'purpose'],
      ['Priority', 'priorityDate'], ['Source', 'source'],
      ['Max flow', 'maxFlowCfs', ' cfs'], ['Max volume', 'maxVolumeAF', ' acre-feet'],
      ['Acres', 'acreage'], ['Well depth', 'wellDepthFt', ' ft'],
      ['Reservoir capacity', 'reservoirCapacityAF', ' acre-feet'],
      ['County', 'county'],
    ],
    NV: [
      ['Status', 'status'], ['Basin', 'basin'], ['County', 'county'],
      ['Priority', 'priorityDate'], ['Source', 'source'],
      ['Duty balance', 'dutyBalanceAF', ' acre-feet'],
      ['Diversion rate', 'diversionRateCfs', ' cfs'],
      ['Place of use', 'placeOfUseAcres', ' acres'],
    ],
    NM: [
      ['Status', 'status'], ['Well status', 'podStatus'], ['Use', 'use'],
      ['Basin', 'basin'], ['County', 'county'],
      ['Surface source', 'surfaceSource'], ['Groundwater', 'groundwaterSource'],
      ['Well depth', 'wellDepthFt', ' ft'],
      ['Static water level', 'staticLevelFt', ' ft'],
      ['Discharge', 'dischargeGpm', ' gpm'],
    ],
    WY: [
      ['Status', 'status'], ['Type', 'facilityType'], ['Uses', 'uses'],
      ['Priority', 'priorityDate'], ['Source', 'streamSource'],
      ['Yield', 'appropriationGpm', ' gpm'],
      ['Total depth', 'totalDepthFt', ' ft'],
      ['Static water level', 'staticWaterLevelFt', ' ft'],
    ],
  };

  const TITLE = {
    ID: (r) => r.name || 'Water right',
    UT: (r) => r.owner || 'Water right',
    MT: (r) => r.owners || r.reservoirName || 'Water right',
    NV: (r) => r.siteName || 'Point of diversion',
    NM: (r) => r.owner || r.podName || 'Point of diversion',
    WY: (r) => r.facilityName || r.owner || r.kind || 'Water right',
  };

  const IDENT = {
    ID: (r) => (r.wrNumber ? 'WR ' + r.wrNumber : null),
    UT: (r) => (r.wrNumber ? 'WR ' + r.wrNumber : null),
    MT: (r) => (r.wrNumber ? 'WR ' + r.wrNumber : null),
    NV: (r) => (r.appNumber ? 'App ' + r.appNumber : null),
    NM: (r) => (r.fileNumber ? 'File ' + r.fileNumber : null),
    WY: (r) => (r.wrNumber ? 'WR ' + r.wrNumber : r.permitNumber ? 'Permit ' + r.permitNumber : null),
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Dates arrive as either a plain string or the {plain, raw} shape the
  // translators use, and a zero flow is "not recorded" rather than none —
  // the same trap this project has hit repeatedly.
  function value(right, key, suffix) {
    let v = right[key];
    if (v == null || v === '') return null;
    if (typeof v === 'object') v = v.plain || v.label || null;
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      if (v === 0) return null;
      v = v.toLocaleString();
    }
    return esc(v) + (suffix || '');
  }

  function ensureStyles() {
    if (document.getElementById('rtPopStyles')) return;
    const s = document.createElement('style');
    s.id = 'rtPopStyles';
    s.textContent = `
      .rt-pop{font-family:'Inter',sans-serif;font-size:13px;line-height:1.45;}
      .rt-pop strong{font-family:'Fraunces',serif;font-size:14.5px;color:var(--river-deep,#1c4552);}
      .rt-pop .rt-id{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink-soft,#52605a);margin:2px 0 7px;}
      .rt-pop table{border-collapse:collapse;width:100%;margin:0 0 8px;}
      .rt-pop td{padding:3px 0;border-bottom:1px dashed var(--line,#ddd6c4);font-size:12.5px;}
      .rt-pop td:first-child{color:var(--ink-soft,#52605a);padding-right:10px;white-space:nowrap;}
      .rt-pop td:last-child{text-align:right;font-weight:500;}
      .rt-pop tr:last-child td{border-bottom:none;}
      .rt-pop-link{display:inline-block;background:var(--river,#2b6777);color:#fff !important;
        padding:6px 11px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;}
      .rt-pop-link:hover{background:var(--river-deep,#1c4552);}
    `;
    document.head.appendChild(s);
  }

  window.buildRightPopup = function buildRightPopup(right, state, opts) {
    ensureStyles();
    const o = opts || {};
    const spec = FIELDS[state] || [];

    const rows = spec
      .map(([label, key, suffix]) => [label, value(right, key, suffix)])
      .filter(([, v]) => v);

    const where = o.onParcel
      ? 'On this parcel'
      : typeof right.distanceMiles === 'number' && isFinite(right.distanceMiles)
        ? (right.distanceMiles < 0.1 ? 'At this location' : right.distanceMiles.toFixed(1) + ' mi away')
        : null;

    const ident = (IDENT[state] || (() => null))(right);
    const meta = [ident, where].filter(Boolean).join(' · ');

    const link = right.officialRecordUrl
      ? `<a href="${esc(right.officialRecordUrl)}" target="_blank" rel="noopener" class="rt-pop-link">📄 Official record</a>`
      : '';

    return `<div class="rt-pop">
      <strong>${esc((TITLE[state] || (() => 'Water right'))(right))}</strong>
      ${meta ? `<div class="rt-id">${esc(meta)}</div>` : ''}
      ${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>` : ''}
      ${link}
    </div>`;
  };
})();
