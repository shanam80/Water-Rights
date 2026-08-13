function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Standard ray-casting point-in-polygon test. Rings from Esri's format are
// [[ [lon,lat], [lon,lat], ... ], ...] — outer boundary plus any holes.
// Testing all rings' edges together in one pass correctly handles holes
// without special-casing them.
function pointInRings(lat, lon, rings) {
  if (!rings) return false;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersects =
        yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

module.exports = { haversineMiles, pointInRings };
