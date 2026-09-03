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

  // Attaches the base layers plus the switcher, and returns the layer that
  // starts visible. Call this instead of adding a tile layer directly.
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

    return street;
  };
})();
