(() => {
  // A longer, more deliberate pull than a modal's swipe-to-close needs, so
  // the two gestures don't compete: closing a sheet is a short, quick drag,
  // refreshing the page requires pulling further and holding it.
  const threshold = 150;
  const maxPull = 180;
  const deadzone = 6;
  const minHoldMs = 350;
  // Mobile browsers routinely report a non-zero scrollTop (1-3px) while
  // "at the top" - iOS Safari's rubber-band bounce and dynamic toolbar in
  // particular never quite settle at an exact 0. Comparing against 0
  // exactly meant the gesture silently refused to start on real phones.
  const atTopTolerance = 4;
  // Inside a category page (#new), that section is the actual scrolling
  // container (position:fixed with its own overflow-y:auto) - the
  // document's own scrollTop stays frozen at 0 the whole time, so checking
  // it here made every pull-up-to-go-back gesture look like "already at
  // the top" no matter how far down the category list the user had
  // scrolled, and triggered a refresh (or the visual pull) instead of a
  // normal scroll.
  const isAtTop = () => {
    if (document.body.classList.contains('category-page-mode')) {
      const section = document.getElementById('new');
      return !section || section.scrollTop <= atTopTolerance;
    }
    return document.scrollingElement.scrollTop <= atTopTolerance;
  };
  let startTime = 0;
  let startY = 0,
    pulling = false,
    dragging = false,
    refreshing = false;
  // Transforming document.body while the category page is open used to
  // break it: #new is position:fixed there, and a `transform` on any
  // ancestor (body included) makes fixed descendants position themselves
  // relative to that ancestor instead of the real viewport - so mid-drag,
  // #new could size itself against body's full (much taller) scrollable
  // height and let whatever real page content sits further down bleed
  // into view at the edge. Dragging #new itself instead avoids that,
  // since a transform on an element never changes what it itself is
  // fixed relative to - only what its own fixed/absolute descendants are.
  let dragTarget = document.body;
  const currentDragTarget = () => {
    if (document.body.classList.contains('category-page-mode')) {
      const section = document.getElementById('new');
      if (section) return section;
    }
    return document.body;
  };

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
    dragTarget.style.transition = `transform ${duration}s ease`;
    dragTarget.style.transform = '';
    dragTarget.style.willChange = '';
    setBarState(0, false);
    bar.style.pointerEvents = 'none';
    document.querySelector('.whatsapp')?.style.setProperty('opacity', '1');
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (refreshing || !isAtTop()) return;
      if (e.target.closest('.whatsapp')) return;
      if (isOverlayOpen()) return;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      pulling = true;
      dragging = false;
      dragTarget = currentDragTarget();
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || refreshing) return;
      if (!isAtTop()) {
        pulling = false;
        if (dragging) {
          resetVisual(0.2);
          dragging = false;
        }
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
      if (!dragging) {
        dragging = true;
        dragTarget.style.willChange = 'transform';
      }
      const pulled = Math.min((distance - deadzone) * 0.55, maxPull);
      dragTarget.style.transition = 'none';
      dragTarget.style.transform = `translateY(${pulled}px)`;
      bar.style.pointerEvents = 'auto';
      const wa = document.querySelector('.whatsapp');
      if (wa) wa.style.opacity = '0';
      setBarState(pulled / threshold, false);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    () => {
      const wasDragging = dragging;
      pulling = false;
      if (!wasDragging) return;
      const match = /translateY\(([\d.]+)px\)/.exec(dragTarget.style.transform || '');
      const pulled = match ? parseFloat(match[1]) : 0;
      const heldLongEnough = Date.now() - startTime >= minHoldMs;
      if (pulled >= threshold && heldLongEnough) {
        dragTarget.style.transition = 'transform .2s ease';
        dragTarget.style.transform = `translateY(${maxPull}px)`;
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
