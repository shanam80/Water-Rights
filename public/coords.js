// A third search method: paste coordinates straight from Google Maps.
//
// Self-wiring — it finds the page's existing Address / Tap-the-map toggle,
// adds a "Coordinates" button and panel matching whatever styling that page
// already uses, and calls the same entry point a map click does. Adding the
// script tag is the only per-page change.
//
// Accepts the formats people actually paste, not just the tidy one:
//   31.565304, -103.585325     (Google Maps "copy coordinates")
//   31.565304 -103.585325
//   31°33'55.1"N 103°35'07.2"W (Google's other display format)
//   a full maps URL containing @lat,lon
(function () {
  const DMS = /(\d+(?:\.\d+)?)\s*[°º:d]\s*(?:(\d+(?:\.\d+)?)\s*['′:m]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|''|s)\s*)?([NSEW])/gi;

  function dmsToDecimal(deg, min, sec, hemi) {
    let value = Number(deg) + Number(min || 0) / 60 + Number(sec || 0) / 3600;
    if (/[SW]/i.test(hemi)) value = -value;
    return value;
  }

  // Returns { lat, lon, note } on success, or { error } with something the
  // reader can act on.
  function parseCoordinates(input) {
    let text = String(input || '').trim();
    if (!text) return { error: 'Paste a pair of coordinates first.' };

    // A pasted Google Maps URL carries the point after an @.
    const urlMatch = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (urlMatch) text = `${urlMatch[1]}, ${urlMatch[2]}`;

    let lat = null;
    let lon = null;

    const dmsMatches = [...text.matchAll(DMS)];
    if (dmsMatches.length >= 2) {
      for (const m of dmsMatches) {
        const value = dmsToDecimal(m[1], m[2], m[3], m[4]);
        if (/[NS]/i.test(m[4])) lat = value;
        else lon = value;
      }
    } else {
      // Decimal pair, separated by a comma and/or whitespace. Trailing
      // N/S/E/W letters are honoured if present.
      const cleaned = text.replace(/[()]/g, ' ').trim();
      const parts = cleaned.split(/\s*,\s*|\s+/).filter(Boolean);
      if (parts.length < 2) {
        return { error: 'Enter two numbers, like 31.565304, -103.585325' };
      }
      const toNum = (part) => {
        // Must contain an actual digit. Without this check, stripping the
        // non-numeric characters out of a word like "not" leaves an empty
        // string, and Number('') is 0 — so garbage input would quietly
        // parse as 0,0 and search the Gulf of Guinea instead of erroring.
        if (!/\d/.test(part)) return null;
        const hemi = (part.match(/[NSEW]/i) || [])[0];
        const num = Number(part.replace(/[^0-9.\-]/g, ''));
        if (!Number.isFinite(num)) return null;
        return hemi && /[SW]/i.test(hemi) ? -Math.abs(num) : num;
      };
      lat = toNum(parts[0]);
      lon = toNum(parts[1]);
    }

    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { error: "That didn't look like coordinates. Try 31.565304, -103.585325" };
    }
    if (Math.abs(lat) > 90) return { error: `Latitude must be between -90 and 90 (got ${lat}).` };
    if (Math.abs(lon) > 180) return { error: `Longitude must be between -180 and 180 (got ${lon}).` };

    // The single most common paste error for this region: dropping the
    // minus sign off the longitude, which silently lands you in Asia. Every
    // state this site covers sits between about -125 and -93, so a positive
    // longitude in that band is almost certainly a lost minus. Corrected,
    // but said out loud rather than silently.
    let note = null;
    if (lon > 93 && lon < 125) {
      lon = -lon;
      note = `Longitude read as ${lon} — western US longitudes are negative, so the minus sign was added back.`;
    }

    return { lat, lon, note };
  }

  window.parseCoordinates = parseCoordinates;

  function init() {
    const toggle = document.querySelector('.method-toggle');
    if (!toggle || toggle.querySelector('[data-method="coords"]')) return;
    const mapBtn = toggle.querySelector('[data-method="map"]');
    const mapPanel = document.getElementById('method-map');
    if (!mapBtn || !mapPanel) return;

    // The page's own search entry — the same one a map click uses, so
    // nothing downstream needs to know where the point came from.
    const search = window.handlePointSelected || window.runSearch;
    if (typeof search !== 'function') return;

    const panel = document.createElement('div');
    panel.className = 'method-panel';
    panel.id = 'method-coords';
    panel.innerHTML = `
      <form id="coordsForm">
        <div class="field">
          <label for="coordsInput">Latitude, longitude</label>
          <input type="text" id="coordsInput" placeholder="31.565304, -103.585325" autocomplete="off" spellcheck="false">
        </div>
        <button type="submit">Go</button>
      </form>
      <p class="map-hint" id="coordsHint">Paste straight from Google Maps — right-click a spot there and choose the coordinates to copy them. Degrees/minutes/seconds and full map links work too.</p>
    `;
    mapPanel.insertAdjacentElement('afterend', panel);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = mapBtn.className.replace(/\bactive\b/, '').trim();
    btn.dataset.method = 'coords';
    btn.textContent = 'Coordinates';
    mapBtn.insertAdjacentElement('afterend', btn);

    // The page wires its toggle with querySelectorAll(...).forEach at load,
    // so a button added afterwards gets no listener from it and the panel
    // would never open. This button therefore does its own switching, using
    // the same classes the page's own handler uses.
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.method-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      panel.classList.add('active');
      panel.querySelector('#coordsInput').focus();
    });


    panel.querySelector('#coordsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const hint = panel.querySelector('#coordsHint');
      const parsed = parseCoordinates(panel.querySelector('#coordsInput').value);

      if (parsed.error) {
        hint.textContent = parsed.error;
        hint.style.color = 'var(--clay)';
        return;
      }
      hint.style.color = '';
      hint.textContent = parsed.note
        ? parsed.note
        : `Searching ${parsed.lat.toFixed(6)}, ${parsed.lon.toFixed(6)}…`;
      search(parsed.lat, parsed.lon);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
