// PWA glue: service worker registration, install prompts, offline state,
// and the install/launch metrics that decide whether a native app is ever
// worth building.
//
// Deliberately does NOT request notification or location permission on
// load. Both kill install rates, and on iOS notification permission isn't
// available until the app is installed anyway.
(function () {
  const DISMISS_KEY = 'acrefoot_install_dismissed_at';
  const VISIT_KEY = 'acrefoot_visits';
  const DISMISS_DAYS = 30;

  function track(name, params) {
    if (typeof gtag === 'function') gtag('event', name, params || {});
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Ask the browser to re-check for a new worker on every load. Without
        // this it may keep an old one for up to a day, which is how a shipped
        // change can stay invisible to returning visitors.
        reg.update().catch(() => {});
      }).catch((err) => {
        console.warn('Service worker registration failed:', err.message);
      });
    });

    // When a new worker takes over, the caches it replaced are gone but this
    // page is still showing whatever the old one served. Reload once so the
    // change is actually visible rather than waiting for a second visit.
    // Guarded so a worker that keeps re-claiming can't loop the page.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      // Only reload if a worker was already in control — on a first-ever
      // visit the page is current and a reload would just be a flash.
      if (read('acrefoot_sw_seen')) window.location.reload();
      store('acrefoot_sw_seen', '1');
    });
    if (navigator.serviceWorker.controller) store('acrefoot_sw_seen', '1');
  }

  // ---------- Launch source ----------
  // start_url carries ?source=pwa, so a launch from the home-screen icon is
  // distinguishable from a browser visit. This is the metric that says
  // whether anyone actually installed.
  const params = new URLSearchParams(location.search);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (params.get('source') === 'pwa' || standalone) {
    track('pwa_launch', { standalone: standalone ? 1 : 0 });
  }

  const visits = Number(read(VISIT_KEY) || 0) + 1;
  store(VISIT_KEY, String(visits));

  // ---------- Offline state ----------
  // A persistent bar, not a toast: if the connection is gone, that stays
  // true and the reader needs to know it while reading, not for three
  // seconds after arriving.
  function ensureBanner() {
    let bar = document.getElementById('offlineBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'offlineBar';
    bar.hidden = true;
    bar.innerHTML = '<span id="offlineBarText">You are offline. Showing saved records where available.</span>';
    document.body.insertBefore(bar, document.body.firstChild);

    const style = document.createElement('style');
    style.textContent = `
      #offlineBar{background:#8a6a12;color:#fff;font-family:'Inter',sans-serif;font-size:13px;
        padding:8px 14px;text-align:center;line-height:1.4;}
      #offlineBar[hidden]{display:none !important;}
      #installCard{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9000;
        max-width:min(420px,calc(100vw - 24px));background:#fffdf8;border:1px solid #ddd6c4;
        border-radius:10px;box-shadow:0 6px 24px rgba(30,42,36,.16);padding:14px 16px;
        font-family:'Inter',sans-serif;color:#1e2a24;}
      #installCard[hidden]{display:none !important;}
      #installCard h4{font-family:'Fraunces',serif;font-size:15px;margin:0 0 5px;color:#1c4552;}
      #installCard p{margin:0 0 10px;font-size:13px;color:#52605a;line-height:1.45;}
      #installCard .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}
      #installCard button{padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;
        border:none;cursor:pointer;font-family:'Inter',sans-serif;}
      #installCard .primary{background:#2b6777;color:#fff;}
      #installCard .ghost{background:#fff;color:#52605a;border:1px solid #ddd6c4;}
    `;
    document.head.appendChild(style);
    return bar;
  }

  function updateOnlineState() {
    const bar = ensureBanner();
    bar.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateOnlineState);
  } else {
    updateOnlineState();
  }

  // ---------- Install prompt ----------
  function recentlyDismissed() {
    const at = Number(read(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  function isIosSafari() {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return iOS && webkit;
  }

  function showCard(html, onInstall) {
    ensureBanner();
    if (document.getElementById('installCard')) return;
    const card = document.createElement('div');
    card.id = 'installCard';
    card.innerHTML = html;
    document.body.appendChild(card);

    card.querySelector('.dismiss').addEventListener('click', () => {
      store(DISMISS_KEY, String(Date.now()));
      card.remove();
      track('pwa_install_dismissed');
    });
    const action = card.querySelector('.primary');
    if (action && onInstall) action.addEventListener('click', () => onInstall(card));
    track('pwa_install_shown', { platform: onInstall ? 'android' : 'ios' });
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress the browser's own banner and hold the event, so the offer is
    // made after a successful lookup rather than on arrival.
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', () => track('pwa_installed'));

  // Called by the pages after a search actually returns something — the
  // moment the value is proven, which is the only time asking makes sense.
  window.maybeOfferInstall = function maybeOfferInstall() {
    if (standalone || recentlyDismissed()) return;

    if (deferredPrompt) {
      showCard(
        `<h4>Add AcreFoot to your home screen</h4>
         <p>Opens like an app, works offline on saved areas, and starts on the map instead of a browser tab.</p>
         <div class="row"><button class="ghost dismiss">Not now</button><button class="primary">Install</button></div>`,
        async (card) => {
          const prompt = deferredPrompt;
          deferredPrompt = null;
          card.remove();
          prompt.prompt();
          const { outcome } = await prompt.userChoice;
          track('pwa_install_choice', { outcome });
        }
      );
      return;
    }

    // iOS has no install API at all, so the only honest option is telling
    // people the actual steps. Held back until a second visit, since a
    // first-time visitor has no reason to want this yet.
    if (isIosSafari() && visits >= 2) {
      showCard(
        `<h4>Add AcreFoot to your home screen</h4>
         <p>Tap the Share button in Safari, then choose <strong>Add to Home Screen</strong>. It opens full screen and keeps saved areas available offline.</p>
         <div class="row"><button class="ghost dismiss">Got it</button></div>`
      );
    }
  };
})();
