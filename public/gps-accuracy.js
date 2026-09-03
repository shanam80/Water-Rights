// Draws the GPS accuracy radius on the map after a "use my location" fix.
//
// Phone GPS is commonly accurate to ±10–50 m, and occasionally far worse
// indoors or under canopy. At a parcel boundary that is the difference
// between two properties, so showing a bare pin implies a precision the
// device does not have. This draws the actual reported radius.
//
// Self-wiring: it wraps geolocation rather than editing eight pages, and
// finds whichever Leaflet map the page created.
(function () {
  if (!navigator.geolocation || !navigator.geolocation.getCurrentPosition) return;

  let accuracyLayer = null;

  function findMap() {
    // Pages name their map differently (map, leafletMap, districtMap).
    for (const name of ['map', 'leafletMap', '_map']) {
      const candidate = window[name];
      if (candidate && typeof candidate.addLayer === 'function' && typeof candidate.getBounds === 'function') {
        return candidate;
      }
    }
    return null;
  }

  function draw(position) {
    const map = findMap();
    if (!map || !window.L) return;
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(accuracy)) return;

    try {
      if (accuracyLayer) map.removeLayer(accuracyLayer);
      const metres = Math.round(accuracy);
      const feet = Math.round(metres * 3.28084);
      accuracyLayer = L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#2b6777',
        fillColor: '#2b6777',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '4,4',
      }).addTo(map);
      accuracyLayer.bindTooltip(
        `Your location, accurate to about ${metres} m (${feet} ft). Anything inside this circle could be where you are.`,
        { sticky: true }
      );
    } catch { /* the fix itself matters more than the circle */ }
  }

  const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  navigator.geolocation.getCurrentPosition = function (success, error, options) {
    return original(
      (position) => {
        // Draw after the page has had a chance to move the map to the fix.
        setTimeout(() => draw(position), 600);
        if (typeof success === 'function') success(position);
      },
      error,
      // Foreground only — iOS has no background location for the web —
      // but ask for the best fix available, since precision is the point.
      Object.assign({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, options || {})
    );
  };
})();
