// Shared base-map layers for every map on the site.
//
// Gives each map a Map/Satellite switcher in the corner, the way Google
// Maps and similar tools work. Satellite matters here more than on a
// typical site: when you're looking at a ditch headgate, a well pad, or a
// district boundary, aerial imagery often tells you what's actually on the
// ground where a road map shows nothing at all.
//
// Both sources are free and need no API key (verified live 2026-09-02).
// Esri's imagery is served without labels, so place names and roads are
// added back as a separate transparent overlay — otherwise satellite view
// is beautiful and impossible to navigate.
(function () {
  const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ESRI_IMAGERY =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_LABELS =
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  // Styles for the expand control live here rather than in eight page
  // stylesheets, so a new map picks them up automatically.
  //
  // This uses a fixed-position overlay rather than the browser's Fullscreen
  // API: the API is blocked in some embedded contexts and needs a user
  // gesture, while this works the same everywhere and still leaves the rest
  // of the page interactive underneath once dismissed. Height and width use
  // !important because pages set their map size with an ID selector
  // (#map{height:340px}), which would otherwise win.
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const css = document.createElement('style');
    css.textContent = `
      .map-expanded{position:fixed !important;top:0;left:0;
        width:100vw !important;height:100vh !important;height:100dvh !important;
        z-index:10000;border-radius:0 !important;margin:0 !important;border:none !important;}
      body.map-is-expanded{overflow:hidden;}
      .leaflet-control-expand a{display:flex;align-items:center;justify-content:center;
        width:30px;height:30px;font-size:15px;line-height:1;text-decoration:none;
        background:#fff;color:#333;cursor:pointer;}
      .leaflet-control-expand a:hover{background:#f4f4f4;}
      .map-expand-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);
        z-index:1000;background:rgba(30,42,36,.82);color:#fff;font-size:12px;
        padding:5px 12px;border-radius:14px;pointer-events:none;}
    `;
    document.head.appendChild(css);
  }

  // Adds the expand/collapse button. Leaflet caches the container size, so
  // invalidateSize() has to run after the class change or the map renders
  // into its old dimensions and tiles come out grey.
  function addExpandControl(map) {
    injectStyles();
    const container = map.getContainer();

    const Control = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-expand');
        const link = L.DomUtil.create('a', '', wrap);
        link.href = '#';
        link.innerHTML = '⛶';
        link.title = 'Expand map to full screen';
        link.setAttribute('role', 'button');
        link.setAttribute('aria-label', 'Expand map to full screen');
        L.DomEvent.on(link, 'click', function (e) {
          L.DomEvent.stop(e);
          toggle();
        });
        this._link = link;
        return wrap;
      },
    });

    let hint = null;
    function toggle(forceOff) {
      const expanded = container.classList.contains('map-expanded');
      const next = forceOff ? false : !expanded;

      container.classList.toggle('map-expanded', next);
      document.body.classList.toggle('map-is-expanded', next);
      if (control._link) {
        control._link.innerHTML = next ? '✕' : '⛶';
        control._link.title = next ? 'Exit full screen (Esc)' : 'Expand map to full screen';
        control._link.setAttribute('aria-label', control._link.title);
      }

      if (next) {
        hint = L.DomUtil.create('div', 'map-expand-hint', container);
        hint.textContent = 'Press Esc to exit full screen';
        setTimeout(() => { if (hint) hint.style.display = 'none'; }, 3200);
      } else if (hint) {
        hint.remove();
        hint = null;
      }

      // Two passes: once after the class applies, once after layout settles,
      // so panes and tiles both land on the new size.
      map.invalidateSize();
      setTimeout(() => map.invalidateSize(), 120);
    }

    const control = new Control();
    map.addControl(control);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && container.classList.contains('map-expanded')) toggle(true);
    });
  }

  // Attaches the base layers, the Map/Satellite switcher and the expand
  // control, and returns the layer that starts visible. Call this instead of
  // adding a tile layer directly.
  window.addBaseLayers = function addBaseLayers(map, options) {
    const opts = options || {};
    const maxZoom = opts.maxZoom || 19;

    const street = L.tileLayer(OSM_URL, {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: maxZoom,
    });

    // Imagery + labels travel together, so the switcher treats them as one
    // choice rather than exposing a confusing third option.
    const satellite = L.layerGroup([
      L.tileLayer(ESRI_IMAGERY, {
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: maxZoom,
      }),
      L.tileLayer(ESRI_LABELS, { maxZoom: maxZoom }),
    ]);

    street.addTo(map);
    L.control
      .layers({ Map: street, Satellite: satellite }, null, { position: 'topright', collapsed: false })
      .addTo(map);

    if (opts.expandable !== false) addExpandControl(map);

    return street;
  };
})();
