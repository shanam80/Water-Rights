// Renders the administrative-restriction banner.
//
// Colorado can say exactly whether a right is curtailed right now, because
// DWR publishes live administrative calls. Idaho and Nevada don't publish
// anything equivalent — but they do publish whether the ground you're
// standing on is inside a critical, managed, moratorium or designated
// area, which is the real restriction signal in those states and the same
// thing WaterMap NM flags.
//
// Deliberately silent when a state has no researched source. Saying
// nothing is correct; an "all clear" for a state nobody has checked would
// be a fabrication.
(function () {
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function ensureStyles() {
    if (document.getElementById('adminAreaStyles')) return;
    const s = document.createElement('style');
    s.id = 'adminAreaStyles';
    s.textContent = `
      .admin-areas{margin:0 0 18px;}
      .admin-area{padding:12px 14px;border-radius:8px;margin-bottom:8px;font-size:13.5px;line-height:1.5;}
      .admin-area:last-child{margin-bottom:0;}
      .admin-area.high{background:#fbeee7;color:var(--clay,#a8643f);}
      .admin-area.medium{background:#fbf3e4;color:var(--amber,#b8863a);}
      .admin-area.info{background:#eef4f1;color:var(--moss,#3f6b4a);}
      .admin-area .aa-head{font-weight:600;}
      .admin-area .aa-detail{font-family:'JetBrains Mono',monospace;font-size:11.5px;opacity:.85;margin-top:3px;}
      .admin-area a{color:inherit;text-decoration:underline;}
      .admin-clear{background:#eef4f1;color:var(--moss,#3f6b4a);padding:11px 14px;border-radius:8px;font-size:13.5px;line-height:1.5;}
    `;
    document.head.appendChild(s);
  }

  // `administrative` is the object the API returns: { supported, areas }.
  window.renderAdministrativeAreas = function renderAdministrativeAreas(administrative, container) {
    if (!container) return;
    let box = container.querySelector('.admin-areas');
    if (!box) {
      box = document.createElement('div');
      box.className = 'admin-areas';
      container.insertBefore(box, container.firstChild);
    }

    if (!administrative || !administrative.supported) {
      box.innerHTML = '';
      return;
    }
    ensureStyles();

    const areas = administrative.areas || [];
    if (areas.length === 0) {
      box.innerHTML = `<div class="admin-clear">
        <strong>No special administrative restriction found at this point.</strong>
        This point isn't inside a critical, managed, moratorium or designated area on the state's own boundary layers. That isn't a guarantee a right here is free from curtailment — it means no area-wide restriction covers this spot.
      </div>`;
      return;
    }

    box.innerHTML = areas.map((a) => `
      <div class="admin-area ${esc(a.severity || 'info')}">
        <div class="aa-head">${esc(a.kind)}${a.name ? ': ' + esc(a.name) : ''}</div>
        <div>${esc(a.note)}</div>
        ${a.detail || a.documentUrl ? `<div class="aa-detail">${a.detail ? esc(a.detail) : ''}${
          a.documentUrl ? ` · <a href="${esc(a.documentUrl)}" target="_blank" rel="noopener">Read the order</a>` : ''
        }</div>` : ''}
      </div>`).join('');
  };
})();
