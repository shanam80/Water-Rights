// One search radius that applies to every search method.
//
// The radius used to live inside the Address panel, which meant tapping the
// map or pasting coordinates silently used a fixed default instead. It now
// sits above the panels, outside all of them, so whichever method you use
// reads the same value.
//
// Self-wiring, like coords.js: it finds the page's method toggle, injects
// the control, and exposes window.getSearchRadius() for the page to use.
(function () {
  // Per-page ceiling. New Mexico checks each well individually, so a wide
  // radius there means hundreds of outbound requests rather than one query.
  const MAX_BY_CONTEXT = { NM: 3, default: 25 };

  let input = null;
  let defaultMiles = 1;

  window.getSearchRadius = function getSearchRadius() {
    if (!input) return defaultMiles;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) return defaultMiles;
    return Math.min(value, currentMax());
  };

  function currentMax() {
    // well-logs.html exposes the selected state; everything else is a
    // single-state page.
    const state = window.currentState;
    return MAX_BY_CONTEXT[state] || MAX_BY_CONTEXT.default;
  }

  function init() {
    const toggle = document.querySelector('.method-toggle');
    if (!toggle || document.getElementById('sharedRadius')) return;

    // If the page already had a radius input inside a panel, adopt its value
    // and remove it — one control, not two disagreeing ones.
    const existing = document.getElementById('radiusA');
    if (existing) {
      defaultMiles = Number(existing.value) || defaultMiles;
      const field = existing.closest('.field');
      (field || existing).remove();
    }

    const row = document.createElement('div');
    row.className = 'radius-row';
    row.innerHTML = `
      <label for="sharedRadius">Search radius</label>
      <input type="number" id="sharedRadius" value="${defaultMiles}" min="0.1" step="0.5">
      <span class="radius-unit">miles</span>
      <span class="radius-note" id="radiusNote">Applies to every search method below.</span>
    `;
    toggle.insertAdjacentElement('afterend', row);
    input = row.querySelector('#sharedRadius');

    const style = document.createElement('style');
    style.textContent = `
      .radius-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;
        margin:0 0 16px;padding:10px 13px;background:#fdfbf5;
        border:1px solid var(--line);border-radius:8px;}
      .radius-row label{font-size:13px;font-weight:500;color:var(--ink-soft);}
      .radius-row input{width:90px;padding:7px 10px;border:1px solid var(--line);
        border-radius:6px;font-family:'Inter',sans-serif;font-size:14px;background:#fff;color:var(--ink);}
      .radius-unit{font-size:13px;color:var(--ink-soft);}
      .radius-note{font-size:12px;color:var(--ink-soft);margin-left:auto;}
      @media (max-width:560px){ .radius-note{margin-left:0;flex-basis:100%;} }
    `;
    document.head.appendChild(style);

    input.addEventListener('change', () => {
      const max = currentMax();
      if (Number(input.value) > max) {
        input.value = max;
        const note = document.getElementById('radiusNote');
        if (note) {
          note.textContent = `Capped at ${max} miles here.`;
          setTimeout(() => { note.textContent = 'Applies to every search method below.'; }, 3500);
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
