(() => {
  const threshold = 100;
  const maxPull = 130;
  const deadzone = 24;
  // Mobile browsers routinely report a non-zero scrollTop (1-3px) while
  // "at the top" - iOS Safari's rubber-band bounce and dynamic toolbar in
  // particular never quite settle at an exact 0. Comparing against 0
  // exactly meant the gesture silently refused to start on real phones.
  const atTopTolerance = 4;
  const isAtTop = () => document.scrollingElement.scrollTop <= atTopTolerance;
  let startY = 0,
    pulling = false,
    dragging = false,
    refreshing = false,
    startTime = 0;

  const container = () => document.querySelector('#appView:not(.hidden)');

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
    transition: 'none',
  });
  bar.style.setProperty('gap', '8px');
  document.body.appendChild(bar);

  const setBarState = (progress, spinning) => {
    bar.style.opacity = String(Math.min(progress, 1));
    bar.style.transform = `translateY(${-20 + Math.min(progress, 1) * 20}px)`;
    const svg = bar.querySelector('svg');
    if (svg) svg.style.animation = spinning ? 'veronzaSpin .7s linear infinite' : 'none';
  };

  if (!document.getElementById('veronzaSpinKeyframes')) {
    const style = document.createElement('style');
    style.id = 'veronzaSpinKeyframes';
    style.textContent = '@keyframes veronzaSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  const isOverlayOpen = () =>
    !!document.querySelector('.modal:not(.hidden)') || !!document.querySelector('.vz-panel.open');

  const doRefresh = () => {
    if (refreshing) return;
    refreshing = true;
    setBarState(1, true);
    bar.style.pointerEvents = 'auto';
    window.location.reload();
  };

  const resetVisual = (duration) => {
    const el = container();
    if (el) {
      el.style.transition = `transform ${duration}s ease`;
      el.style.transform = '';
    }
    setBarState(0, false);
    bar.style.pointerEvents = 'none';
  };

  // iOS can abort a touch sequence mid-drag without ever firing touchend or
  // touchcancel (an incoming call banner, Control Center, the app switcher)
  // - that left the drag's transform stuck on #appView indefinitely, which
  // breaks position:fixed for the bottom-nav living inside it (a transform
  // on an ancestor makes fixed descendants position themselves relative to
  // that ancestor instead of the real viewport). Mirrors the same
  // self-healing added to the customer-facing pull-to-refresh.js: a
  // watchdog re-armed on every touchmove tick, plus a check on the next
  // touchstart and on backgrounding, so a stuck transform never survives
  // more than ~1.5s or the next touch, whichever comes first.
  let dragWatchdog = null;
  const armDragWatchdog = () => {
    clearTimeout(dragWatchdog);
    dragWatchdog = setTimeout(() => {
      if (dragging) {
        dragging = false;
        pulling = false;
        resetVisual(0.2);
      }
    }, 1500);
  };
  const clearDragWatchdog = () => {
    clearTimeout(dragWatchdog);
    dragWatchdog = null;
  };

  bar.style.pointerEvents = 'none';
  bar.addEventListener('click', () => {
    if (parseFloat(bar.style.opacity) > 0.5) doRefresh();
  });

  document.addEventListener(
    'touchstart',
    (e) => {
      const el = container();
      if (dragging || (el && el.style.transform)) {
        clearDragWatchdog();
        resetVisual(0);
        dragging = false;
      }
      if (!el || refreshing || !isAtTop()) return;
      if (isOverlayOpen()) return;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      pulling = true;
      dragging = false;
    },
    { passive: true },
  );

  document.addEventListener('visibilitychange', () => {
    const el = container();
    if (document.hidden && (dragging || (el && el.style.transform))) {
      clearDragWatchdog();
      resetVisual(0);
      dragging = false;
      pulling = false;
    }
  });

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || refreshing) return;
      const el = container();
      if (!el) return;
      if (!isAtTop()) {
        pulling = false;
        if (dragging) {
          clearDragWatchdog();
          resetVisual(0.2);
          dragging = false;
        }
        return;
      }
      const distance = e.touches[0].clientY - startY;
      if (distance <= 0) {
        if (dragging) {
          clearDragWatchdog();
          resetVisual(0.2);
          dragging = false;
        }
        return;
      }
      if (distance < deadzone) {
        if (dragging) {
          clearDragWatchdog();
          resetVisual(0.2);
          dragging = false;
        }
        return;
      }
      dragging = true;
      const pulled = Math.min((distance - deadzone) * 0.4, maxPull);
      el.style.transition = 'none';
      el.style.transform = `translateY(${pulled}px)`;
      bar.style.pointerEvents = 'auto';
      setBarState(pulled / threshold, false);
      armDragWatchdog();
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    () => {
      const wasDragging = dragging;
      pulling = false;
      clearDragWatchdog();
      if (!wasDragging) return;
      const el = container();
      if (!el) {
        dragging = false;
        return;
      }
      const currentTransform = el.style.transform;
      const match = /translateY\(([\d.]+)px\)/.exec(currentTransform || '');
      const pulled = match ? parseFloat(match[1]) : 0;
      const heldLongEnough = Date.now() - startTime >= 150;
      if (pulled >= threshold && heldLongEnough) {
        el.style.transition = 'transform .2s ease';
        el.style.transform = `translateY(${maxPull}px)`;
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
      clearDragWatchdog();
      if (!dragging) return;
      resetVisual(0.2);
      pulling = false;
      dragging = false;
    },
    { passive: true },
  );
})();
