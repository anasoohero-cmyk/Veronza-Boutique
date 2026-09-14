(() => {
  let startY = 0;
  let pulling = false;
  let refreshing = false;
  const threshold = 68;
  const maxPull = 100;

  const indicator = document.createElement('div');
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
  Object.assign(indicator.style, {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
    left: '50%',
    width: '36px',
    height: '36px',
    marginLeft: '-18px',
    borderRadius: '50%',
    background: '#111',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '99999',
    opacity: '0',
    transform: 'translateY(-50px) rotate(0deg)',
    boxShadow: '0 4px 14px rgba(0,0,0,.25)',
    willChange: 'transform, opacity'
  });
  document.body.appendChild(indicator);

  const isOverlayOpen = () => !!document.querySelector(
    '.cart-drawer.open,.search-panel.open,.mobile-menu.open,.product-details-modal.open,[data-checkout-modal].open,.veronza-lightbox.open'
  );

  const setTransition = (on) => {
    indicator.style.transition = on ? 'transform .25s ease, opacity .25s ease' : 'none';
  };

  const spinKeyframes = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];
  let spinAnim = null;
  const startSpin = () => {
    setTransition(true);
    indicator.style.transform = 'translateY(28px) rotate(0deg)';
    indicator.style.opacity = '1';
    spinAnim = indicator.animate(spinKeyframes, { duration: 700, iterations: Infinity });
  };
  const stopSpin = () => { spinAnim?.cancel(); spinAnim = null; };

  const reset = () => {
    setTransition(true);
    indicator.style.transform = 'translateY(-50px) rotate(0deg)';
    indicator.style.opacity = '0';
  };

  const follow = (distance) => {
    const pulled = Math.min(distance * 0.5, maxPull);
    const progress = Math.min(pulled / threshold, 1);
    setTransition(false);
    indicator.style.transform = `translateY(${pulled - 24}px) rotate(${progress * 360}deg)`;
    indicator.style.opacity = String(progress);
  };

  const softRefresh = async () => {
    refreshing = true;
    startSpin();
    try {
      window.productsLoadPromise = null;
      await window.loadProductsFromSupabase?.();
      window.veronzaRefreshView?.();
      window.veronzaToast?.('تم تحديث المنتجات ✓');
    } catch (_) {
    } finally {
      stopSpin();
      reset();
      refreshing = false;
    }
  };

  document.addEventListener('touchstart', e => {
    if (refreshing || document.scrollingElement.scrollTop !== 0) return;
    if (e.target.closest('.whatsapp')) return;
    if (isOverlayOpen()) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling || refreshing) return;
    if (document.scrollingElement.scrollTop !== 0) { pulling = false; reset(); return }
    const distance = e.touches[0].clientY - startY;
    if (distance <= 0) { reset(); return }
    if (e.cancelable) e.preventDefault();
    follow(distance);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!pulling || refreshing) return;
    pulling = false;
    const reached = parseFloat(indicator.style.opacity) >= 1;
    if (!reached) { reset(); return }
    softRefresh();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (pulling && !refreshing) { pulling = false; reset() }
  }, { passive: true });
})();
