(() => {
  const CHECK_INTERVAL = 60000;
  const VERSION_KEY = 'veronza:lastVersion';
  const RESTORE_KEY = 'veronza:restoreAfterUpdate';
  const RESTORE_MAX_AGE_MS = 5 * 60 * 1000;
  let currentVersion = null;
  let checking = false;
  let reloadQueued = false;

  // Figures out which window (if any) is open right now, on either the
  // customer site or the admin panel, plus enough context (an order id, a
  // status filter, a product id...) for that specific page's own script to
  // put the person back exactly where they were after the reload. The
  // product details modal isn't listed here — it already restores itself
  // via its own ?p= URL parameter, which survives a reload on its own.
  const captureWindowState = () => {
    if (document.querySelector('.cart-drawer.open')) return { window: 'cart' };
    if (document.querySelector('[data-checkout-modal].open')) return { window: 'checkout' };
    if (document.querySelector('.mobile-menu.open')) return { window: 'mobile-menu' };
    if (document.querySelector('.search-panel.open')) return { window: 'search-panel' };
    if (document.querySelector('.auth-modal.open')) return { window: 'auth-modal' };
    if (document.querySelector('.vz-chat-panel.open')) return { window: 'chat-panel' };

    const orderModal = document.querySelector('#orderModal');
    if (orderModal && !orderModal.classList.contains('hidden')) {
      return { window: 'admin-order', context: { orderId: window.selected?.id || null } };
    }
    const statusModal = document.querySelector('#statusModal');
    if (statusModal && !statusModal.classList.contains('hidden')) {
      return { window: 'admin-status', context: { status: window.filter || 'all' } };
    }
    const manualOrderModal = document.querySelector('#manualOrderModal');
    if (manualOrderModal && !manualOrderModal.classList.contains('hidden')) {
      return { window: 'admin-manual-order' };
    }
    const productModal = document.querySelector('#modal');
    if (productModal && !productModal.classList.contains('hidden')) {
      return {
        window: 'admin-product-edit',
        context: { productId: document.querySelector('#productId')?.value || null },
      };
    }
    if (document.querySelector('.vz-chatw-panel.open')) return { window: 'admin-chat-widget' };
    return { window: null };
  };

  const saveRestoreState = () => {
    try {
      const state = captureWindowState();
      state.scrollY = window.scrollY;
      state.savedAt = Date.now();
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify(state));
    } catch (_) {}
  };

  // Each page's own script calls this once, after it's ready to act on it,
  // to pick up (and clear) whatever was saved just before the reload.
  window.veronzaConsumeRestoreState = () => {
    try {
      const raw = sessionStorage.getItem(RESTORE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(RESTORE_KEY);
      const state = JSON.parse(raw);
      if (!state || Date.now() - (state.savedAt || 0) > RESTORE_MAX_AGE_MS) return null;
      return state;
    } catch (_) {
      return null;
    }
  };

  const reloadWhenSafe = (version) => {
    if (reloadQueued) return;
    reloadQueued = true;
    if (version) {
      try {
        localStorage.setItem(VERSION_KEY, version);
      } catch (_) {}
    }
    const attemptReload = () => {
      if (document.visibilityState !== 'visible') {
        document.addEventListener('visibilitychange', attemptReload, { once: true });
        return;
      }
      saveRestoreState();
      window.location.reload();
    };
    attemptReload();
  };

  if ('serviceWorker' in navigator) {
    const hadControllerAtStart = !!navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => {
        setInterval(() => reg.update().catch(() => {}), CHECK_INTERVAL);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
    let controllerChanged = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controllerChanged) return;
      controllerChanged = true;
      if (!hadControllerAtStart) return;
      reloadWhenSafe(null);
    });
  }

  const check = async () => {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const response = await fetch(`/api/version?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) return;
      const data = await response.json();
      const version = data?.version;
      if (!version) return;
      let savedVersion = null;
      try {
        savedVersion = localStorage.getItem(VERSION_KEY);
      } catch (_) {}
      if (currentVersion === null) currentVersion = version;
      if (savedVersion === null) {
        try {
          localStorage.setItem(VERSION_KEY, version);
        } catch (_) {}
        return;
      }
      if (version !== savedVersion) reloadWhenSafe(version);
    } catch (_) {
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

  if (new URLSearchParams(location.search).get('diag') === '1') {
    const panel = document.createElement('pre');
    panel.id = 'veronzaDiag';
    panel.dir = 'rtl';
    panel.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:12px;background:#111;color:#fff;border-radius:12px;font:13px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;white-space:pre-wrap;max-height:45vh;overflow:auto;box-shadow:0 4px 24px rgba(0,0,0,.35)';
    panel.textContent = 'تشخيص السبيدروات: اضغط «السبيدروات»…';
    document.body.appendChild(panel);
    const show = (lines) => {
      panel.textContent = lines.join('\n');
    };
    const runDiagnostic = async () => {
      show(['تشخيص السبيدروات: جارٍ الفحص…']);
      const lines = [];
      try {
        const response = await fetch(
          'https://kahbxvbirsjmednkybse.supabase.co/rest/v1/products?select=id,type,is_active&is_active=eq.true&order=id.asc',
          {
            cache: 'no-store',
            headers: {
              apikey: 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm',
              Authorization: 'Bearer sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm',
            },
          },
        );
        const db = await response.json();
        lines.push(`DB active: ${Array.isArray(db) ? db.length : 'ERROR'}`);
        lines.push(
          `DB shoes: ${Array.isArray(db) ? db.filter((p) => p.type === 'shoes').length : 'ERROR'}`,
        );
      } catch (error) {
        lines.push(`DB: ERROR — ${error?.message || error}`);
      }
      const products = Array.isArray(window.products) ? window.products : [];
      lines.push(`window.products: ${products.length}`);
      lines.push(`window shoes: ${products.filter((p) => p.type === 'shoes').length}`);
      lines.push(
        `VISIBLE CARDS الآن: ${document.querySelectorAll('#productGrid .product').length}`,
      );
      show(lines);
      setTimeout(() => {
        lines.push(
          `VISIBLE CARDS بعد 1s: ${document.querySelectorAll('#productGrid .product').length}`,
        );
        show(lines);
      }, 1000);
      setTimeout(() => {
        lines.push(
          `VISIBLE CARDS بعد 8s: ${document.querySelectorAll('#productGrid .product').length}`,
        );
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
