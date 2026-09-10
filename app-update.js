(() => {
  const CHECK_INTERVAL = 60000;
  let currentVersion = null;
  let checking = false;
  let reloadQueued = false;

  const reloadWhenSafe = () => {
    if (reloadQueued) return;
    reloadQueued = true;
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
      if (currentVersion === null) {
        currentVersion = version;
        return;
      }
      if (version !== currentVersion) reloadWhenSafe();
    } catch (_) {
      // A temporary network failure must never affect the storefront.
    } finally {
      checking = false;
    }
  };

  check();
  setInterval(check, CHECK_INTERVAL);
})();
