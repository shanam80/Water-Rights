// Adds "Save this area for offline" to any search page, plus the offline
// staleness banner. Self-wiring like coords.js and radius.js, so pages only
// need the script tag.
//
// A page opts in by setting window.offlineAreaContext(result) — or by
// simply having a results panel; the button attaches to the first one it
// finds and reads what the page last searched.
(function () {
  const STATE_PAGES = {
    '/': 'CO', '/index.html': 'CO', '/idaho.html': 'ID', '/utah.html': 'UT',
    '/montana.html': 'MT', '/nevada.html': 'NV', '/texas.html': 'TX',
    '/wyoming.html': 'WY', '/newmexico.html': 'NM_WATER', '/well-logs.html': 'NM',
  };

  function currentState() {
    // well-logs.html can be either state; it exposes which one is selected.
    if (location.pathname === '/well-logs.html') return window.currentState || 'TX';
    return STATE_PAGES[location.pathname] || 'CO';
  }

  function apiUrlFor(state, lat, lon, radius) {
    // New Mexico water rights are a separate tool from the NM well logs,
    // so they carry a distinct key rather than colliding on 'NM'.
    if (state === 'NM_WATER') return `/api/new-mexico/water-rights?lat=${lat}&lon=${lon}&radius=${radius}`;
    if (state === 'NM' || (state === 'TX' && location.pathname === '/well-logs.html')) {
      return `/api/well-logs?state=${state}&lat=${lat}&lon=${lon}&radius=${radius}`;
    }
    if (state === 'TX') return `/api/texas/wells/nearby?lat=${lat}&lon=${lon}&radius=${radius}`;
    return `/api/${state === 'CO' ? 'colorado' : state === 'ID' ? 'idaho' : state === 'UT' ? 'utah'
      : state === 'MT' ? 'montana' : state === 'NV' ? 'nevada' : 'wyoming'}/water-rights?lat=${lat}&lon=${lon}&radius=${radius}`;
  }

  function ensureStyles() {
    if (document.getElementById('offlineUiStyles')) return;
    const s = document.createElement('style');
    s.id = 'offlineUiStyles';
    s.textContent = `
      .offline-save{margin-top:16px;padding:14px 16px;border:1px solid var(--line,#ddd6c4);
        border-radius:9px;background:#fdfbf5;}
      .offline-save h3{font-family:'Fraunces',serif;font-size:14.5px;margin:0 0 4px;color:var(--river-deep,#1c4552);}
      .offline-save p{margin:0 0 10px;font-size:12.5px;color:var(--ink-soft,#52605a);line-height:1.45;}
      .offline-save .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
      .offline-save button{padding:8px 14px;font-size:13px;}
      .offline-save .ghost{background:#fff;color:var(--river,#2b6777);border:1px solid var(--river,#2b6777);}
      .staleness{margin:0 0 16px;padding:9px 12px;border-radius:7px;font-size:13px;line-height:1.45;}
      .staleness.fresh{background:#eef4f1;color:var(--moss,#3f6b4a);}
      .staleness.stale{background:#fbf3e4;color:var(--amber,#b8863a);}
    `;
    document.head.appendChild(s);
  }

  // A saved set is a snapshot. Whenever one is on screen the page says so,
  // persistently — never presented as live data.
  window.showStalenessBanner = function showStalenessBanner(record, container) {
    ensureStyles();
    const host = container || document.querySelector('.panel:last-of-type') || document.body;
    let el = document.getElementById('stalenessBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'stalenessBanner';
      host.insertBefore(el, host.firstChild);
    }
    el.className = 'staleness ' + (window.OfflineAreas.isStale(record) ? 'stale' : 'fresh');
    el.textContent = window.OfflineAreas.describeAge(record);
  };

  window.attachOfflineSave = function attachOfflineSave(panel, context) {
    if (!window.OfflineAreas || !panel) return;
    ensureStyles();

    let box = panel.querySelector('.offline-save');
    if (!box) {
      box = document.createElement('div');
      box.className = 'offline-save';
      panel.appendChild(box);
    }

    const state = context.state || currentState();
    const label = context.label ||
      `${state} · ${context.lat.toFixed(4)}, ${context.lon.toFixed(4)}`;
    const id = `${state}:${context.lat.toFixed(4)},${context.lon.toFixed(4)}:${context.radiusMiles}`;
    // Size is shown before anything downloads — the payload is already in
    // hand, so this is the real number, not an estimate.
    const bytes = new Blob([JSON.stringify(context.payload || {})]).size;

    box.innerHTML = `
      <h3>Save this area for offline</h3>
      <p>Keeps these records on your device so they open without a connection — useful standing on the property with one bar. About ${window.OfflineAreas.formatBytes(bytes)}. Nothing downloads until you tap.</p>
      <div class="row">
        <button type="button" class="ghost" id="offlineSaveBtn">Save ${window.OfflineAreas.formatBytes(bytes)}</button>
        <span id="offlineSaveMsg" style="font-size:12.5px;color:var(--ink-soft,#52605a);"></span>
      </div>`;

    box.querySelector('#offlineSaveBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const msg = box.querySelector('#offlineSaveMsg');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const record = await window.OfflineAreas.saveArea({
          id, label, state,
          lat: context.lat, lon: context.lon,
          radiusMiles: context.radiusMiles,
          payload: context.payload,
        });
        record.refreshUrl = apiUrlFor(state, context.lat, context.lon, context.radiusMiles);
        btn.textContent = 'Saved';
        const persisted = await window.OfflineAreas.requestPersistence();
        msg.innerHTML = persisted
          ? 'Available offline. <a href="/saved.html">Manage saved areas</a>'
          : 'Available offline, though the browser may evict it if space runs low. <a href="/saved.html">Manage</a>';
        if (typeof gtag === 'function') {
          gtag('event', 'offline_area_saved', { state, bytes: record.bytes });
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Try again';
        msg.textContent = 'Could not save on this device.';
      }
    });
  };

  // Rather than editing seven pages' internals, the completed search is
  // detected here: every page fetches its records from /api/, so wrapping
  // fetch catches the moment results arrive regardless of how each page is
  // written. Purely additive — the original response is passed through
  // untouched, and any failure here is swallowed so a lookup can never
  // break because of the offline layer.
  const POINT_SEARCH = /\/api\/(colorado|idaho|utah|montana|nevada|new-mexico|wyoming|texas\/wells|well-logs)(\/|\?)/;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const promise = nativeFetch(input, init);
    if (!POINT_SEARCH.test(url) || url.includes('/document')) return promise;

    return promise.then((response) => {
      try {
        const params = new URL(url, location.origin).searchParams;
        const lat = Number(params.get('lat'));
        const lon = Number(params.get('lon'));
        const radius = Number(params.get('radius')) || (window.getSearchRadius ? window.getSearchRadius() : 1);
        if (response.ok && Number.isFinite(lat) && Number.isFinite(lon)) {
          response.clone().json().then((payload) => {
            // Let the page finish painting before appending to its panel.
            setTimeout(() => {
              if (typeof window.__pwaAfterSearch === 'function') {
                window.__pwaAfterSearch(payload, lat, lon, radius);
              }
            }, 300);
          }).catch(() => {});
        }
      } catch { /* never interfere with the actual request */ }
      return response;
    });
  };

  // If the page was opened from a saved area, load it from storage rather
  // than the network and say plainly that it's a snapshot.
  window.loadSavedAreaIfRequested = async function loadSavedAreaIfRequested() {
    const id = new URLSearchParams(location.search).get('offline');
    if (!id || !window.OfflineAreas) return null;
    try {
      const record = await window.OfflineAreas.get(id);
      if (!record) return null;
      if (typeof gtag === 'function') gtag('event', 'offline_session_served');
      return record;
    } catch {
      return null;
    }
  };
})();
