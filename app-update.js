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
})();
