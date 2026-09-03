// "Save this area for offline" — the field use case: standing on a
// property with one bar, wanting the records for where you're standing.
//
// Two rules from the brief drive the design, and both are correctness
// issues rather than polish:
//
//   1. Never auto-download. Rural users are often on metered connections,
//      so a save is always an explicit tap with the size shown first.
//   2. Cached records must never be presented as live. Every saved set
//      carries a savedAt, and the UI states it whenever it serves one.
//      Water rights change; an undated record is a real-world risk for a
//      legal-adjacent product.
(function () {
  const DB_NAME = 'acrefoot-offline';
  const DB_VERSION = 1;
  const STORE = 'areas';
  const STALE_DAYS = 30;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  }

  const api = {
    async list() {
      const rows = await tx('readonly', (s) => s.getAll());
      return (rows || []).sort((a, b) => b.savedAt - a.savedAt);
    },

    async get(id) {
      return tx('readonly', (s) => s.get(id));
    },

    async remove(id) {
      await tx('readwrite', (s) => s.delete(id));
    },

    // Storage can be evicted under pressure, especially on iOS. Asking for
    // persistence only makes sense after a deliberate save — asking on load
    // is exactly the kind of unprompted permission the brief warns against.
    async requestPersistence() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          const already = await navigator.storage.persisted();
          if (already) return true;
          return await navigator.storage.persist();
        }
      } catch { /* refusal is normal and not an error */ }
      return false;
    },

    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          return await navigator.storage.estimate();
        }
      } catch { /* unsupported */ }
      return null;
    },

    // Fetches the records for a point and stores them with a timestamp.
    // The caller shows the size first; this does the saving.
    async saveArea({ id, label, state, lat, lon, radiusMiles, payload }) {
      const record = {
        id,
        label,
        state,
        lat,
        lon,
        radiusMiles,
        payload,
        savedAt: Date.now(),
        bytes: new Blob([JSON.stringify(payload)]).size,
      };
      await tx('readwrite', (s) => s.put(record));
      await api.requestPersistence();
      return record;
    },

    isStale(record) {
      return Date.now() - record.savedAt > STALE_DAYS * 24 * 60 * 60 * 1000;
    },

    // "records as of 12 March 2026" — the phrasing the brief asks for.
    describeAge(record) {
      const d = new Date(record.savedAt);
      const on = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return api.isStale(record)
        ? `Saved records from ${on} — over ${STALE_DAYS} days old. Refresh when you have a connection.`
        : `Offline — records as of ${on}.`;
    },

    formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
  };

  window.OfflineAreas = api;
})();
