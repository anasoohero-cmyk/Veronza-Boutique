(() => {
  const CHECK_INTERVAL = 60000;
  const VERSION_KEY = 'veronza:lastVersion';
  let currentVersion = null;
  let checking = false;
  let reloadQueued = false;

  const reloadWhenSafe = (version) => {
    if (reloadQueued) return;
    reloadQueued = true;
    try { localStorage.setItem(VERSION_KEY, version); } catch (_) {}
    const reload = () => {
      if (document.visibilityState === 'visible') window.location.reload();
      else document.addEventListener('visibilitychange', reload, { once: true });
    };
    reload();
  };

  const check = async () => {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const response = await fetch(`/api/version?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!response.ok) return;
      const data = await response.json();
      const version = data?.version;
      if (!version) return;
      let savedVersion = null;
      try { savedVersion = localStorage.getItem(VERSION_KEY); } catch (_) {}
      if (currentVersion === null) currentVersion = version;
      if (savedVersion === null) {
        try { localStorage.setItem(VERSION_KEY, version); } catch (_) {}
        return;
      }
      if (version !== savedVersion) reloadWhenSafe(version);
    } catch (_) {
      // A temporary network failure must never affect the storefront.
    } finally {
      checking = false;
    }
  };

  check();
  setInterval(check, CHECK_INTERVAL);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  // Opt-in, read-only category diagnostic. It runs only when ?diag=1 is present.
  if (new URLSearchParams(location.search).get('diag') === '1') {
    const panel = document.createElement('pre');
    panel.id = 'veronzaDiag';
    panel.dir = 'rtl';
    panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:12px;background:#111;color:#fff;border-radius:12px;font:13px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;white-space:pre-wrap;max-height:45vh;overflow:auto;box-shadow:0 4px 24px rgba(0,0,0,.35)';
    panel.textContent = 'تشخيص السبيدروات: اضغط «السبيدروات»…';
    document.body.appendChild(panel);

    const show = (lines) => { panel.textContent = lines.join('\n'); };
    const runDiagnostic = async () => {
      show(['تشخيص السبيدروات: جارٍ الفحص…']);
      const lines = [];
      try {
        const response = await fetch('https://kahbxvbirsjmednkybse.supabase.co/rest/v1/products?select=id,type,is_active&is_active=eq.true&order=id.asc', {
          cache: 'no-store',
          headers: {
            apikey: 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm',
            Authorization: 'Bearer sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm'
          }
        });
        const db = await response.json();
        lines.push(`DB active: ${Array.isArray(db) ? db.length : 'ERROR'}`);
        lines.push(`DB shoes: ${Array.isArray(db) ? db.filter(p => p.type === 'shoes').length : 'ERROR'}`);
      } catch (error) {
        lines.push(`DB: ERROR — ${error?.message || error}`);
      }
      const products = Array.isArray(window.products) ? window.products : [];
      lines.push(`window.products: ${products.length}`);
      lines.push(`window shoes: ${products.filter(p => p.type === 'shoes').length}`);
      lines.push(`VISIBLE CARDS الآن: ${document.querySelectorAll('#productGrid .product-card').length}`);
      show(lines);
      setTimeout(() => {
        lines.push(`VISIBLE CARDS بعد 1s: ${document.querySelectorAll('#productGrid .product-card').length}`);
        show(lines);
      }, 1000);
      setTimeout(() => {
        lines.push(`VISIBLE CARDS بعد 8s: ${document.querySelectorAll('#productGrid .product-card').length}`);
        show(lines);
      }, 8000);
    };

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-category="shoes"]')) {
        setTimeout(runDiagnostic, 150);
      }
    });
  }
})();
