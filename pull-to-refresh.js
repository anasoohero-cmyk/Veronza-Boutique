(() => {
  // A longer, more deliberate pull than a modal's swipe-to-close needs, so
  // the two gestures don't compete: closing a sheet is a short, quick drag,
  // refreshing the page requires pulling further and holding it.
  const threshold = 150;
  const maxPull = 180;
  const deadzone = 6;
  const minHoldMs = 350;
  let startTime = 0;
  let startY = 0,
    pulling = false,
    dragging = false,
    refreshing = false;

  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>تحديث</span>';
  Object.assign(bar.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: maxPull + 'px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: '8px',
    paddingBottom: '18px',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    color: '#111',
    fontWeight: '700',
    fontSize: '13px',
    fontFamily: 'Cairo, Arial, sans-serif',
    zIndex: '9998',
    opacity: '0',
    transform: 'translateY(-20px)',
    pointerEvents: 'none',
  });
  document.body.appendChild(bar);

  if (!document.getElementById('veronzaSpinKeyframes')) {
    const style = document.createElement('style');
    style.id = 'veronzaSpinKeyframes';
    style.textContent = '@keyframes veronzaSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  const setBarState = (progress, spinning) => {
    bar.style.opacity = String(Math.min(progress, 1));
    bar.style.transform = `translateY(${-20 + Math.min(progress, 1) * 20}px)`;
    const svg = bar.querySelector('svg');
    if (svg) svg.style.animation = spinning ? 'veronzaSpin .7s linear infinite' : 'none';
  };

  const isOverlayOpen = () =>
    !!document.querySelector(
      '.cart-drawer.open,.search-panel.open,.mobile-menu.open,.product-details-modal.open,[data-checkout-modal].open,.veronza-lightbox.open,.auth-modal.open,.order-ready.open,.vz-chat-panel.open',
    );

  const doRefresh = () => {
    if (refreshing) return;
    refreshing = true;
    setBarState(1, true);
    window.location.reload();
  };

  bar.addEventListener('click', () => {
    if (parseFloat(bar.style.opacity) > 0.5) doRefresh();
  });

  const brand = document.querySelector('.brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.setAttribute('role', 'button');
    brand.setAttribute('aria-label', 'الذهاب إلى الأقسام');
    brand.addEventListener('click', () => {
      const target = document.getElementById('sections');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const resetVisual = (duration) => {
    document.body.style.transition = `transform ${duration}s ease`;
    document.body.style.transform = '';
    document.body.style.willChange = '';
    setBarState(0, false);
    bar.style.pointerEvents = 'none';
    document.querySelector('.whatsapp')?.style.setProperty('opacity', '1');
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (refreshing || document.scrollingElement.scrollTop !== 0) return;
      if (e.target.closest('.whatsapp')) return;
      if (isOverlayOpen()) return;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      pulling = true;
      dragging = false;
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || refreshing) return;
      if (document.scrollingElement.scrollTop !== 0) {
        pulling = false;
        return;
      }
      const distance = e.touches[0].clientY - startY;
      if (distance <= 0) {
        if (dragging) {
          resetVisual(0.2);
          dragging = false;
        }
        return;
      }
      if (distance < deadzone) return;
      if (e.cancelable) e.preventDefault();
      if (!dragging) {
        dragging = true;
        document.body.style.willChange = 'transform';
      }
      const pulled = Math.min((distance - deadzone) * 0.55, maxPull);
      document.body.style.transition = 'none';
      document.body.style.transform = `translateY(${pulled}px)`;
      bar.style.pointerEvents = 'auto';
      const wa = document.querySelector('.whatsapp');
      if (wa) wa.style.opacity = '0';
      setBarState(pulled / threshold, false);
    },
    { passive: false },
  );

  document.addEventListener(
    'touchend',
    () => {
      if (!pulling) return;
      pulling = false;
      if (!dragging) return;
      const match = /translateY\(([\d.]+)px\)/.exec(document.body.style.transform || '');
      const pulled = match ? parseFloat(match[1]) : 0;
      const heldLongEnough = Date.now() - startTime >= minHoldMs;
      if (pulled >= threshold && heldLongEnough) {
        document.body.style.transition = 'transform .2s ease';
        document.body.style.transform = `translateY(${maxPull}px)`;
        doRefresh();
      } else {
        resetVisual(0.25);
      }
      dragging = false;
    },
    { passive: true },
  );

  document.addEventListener(
    'touchcancel',
    () => {
      if (!dragging) return;
      resetVisual(0.2);
      pulling = false;
      dragging = false;
    },
    { passive: true },
  );
})();
