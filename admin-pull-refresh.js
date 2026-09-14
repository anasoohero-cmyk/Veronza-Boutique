(() => {
  const threshold = 70;
  const maxPull = 110;
  let startY = 0, pulling = false, dragging = false, refreshing = false;

  const container = () => document.querySelector('#appView:not(.hidden)');

  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>تحديث</span>';
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
    transition: 'none'
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

  const isOverlayOpen = () => !!document.querySelector('.modal:not(.hidden)');

  const doRefresh = () => {
    if (refreshing) return;
    refreshing = true;
    setBarState(1, true);
    bar.style.pointerEvents = 'auto';
    window.location.reload();
  };

  bar.style.pointerEvents = 'none';
  bar.addEventListener('click', () => { if (parseFloat(bar.style.opacity) > 0.5) doRefresh(); });

  document.addEventListener('touchstart', e => {
    const el = container();
    if (!el || refreshing || document.scrollingElement.scrollTop !== 0) return;
    if (isOverlayOpen()) return;
    startY = e.touches[0].clientY;
    pulling = true;
    dragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling || refreshing) return;
    const el = container();
    if (!el) return;
    if (document.scrollingElement.scrollTop !== 0) { pulling = false; return }
    const distance = e.touches[0].clientY - startY;
    if (distance <= 0) {
      if (dragging) { el.style.transition = 'transform .2s ease'; el.style.transform = ''; setBarState(0, false); dragging = false }
      return;
    }
    if (e.cancelable) e.preventDefault();
    dragging = true;
    const pulled = Math.min(distance * 0.5, maxPull);
    el.style.transition = 'none';
    el.style.transform = `translateY(${pulled}px)`;
    bar.style.pointerEvents = 'auto';
    setBarState(pulled / threshold, false);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const el = container();
    if (!el || !dragging) return;
    const currentTransform = el.style.transform;
    const match = /translateY\(([\d.]+)px\)/.exec(currentTransform || '');
    const pulled = match ? parseFloat(match[1]) : 0;
    if (pulled >= threshold) {
      el.style.transition = 'transform .2s ease';
      el.style.transform = `translateY(${maxPull}px)`;
      doRefresh();
    } else {
      el.style.transition = 'transform .25s ease';
      el.style.transform = '';
      setBarState(0, false);
      bar.style.pointerEvents = 'none';
    }
    dragging = false;
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (!dragging) return;
    const el = container();
    if (el) { el.style.transition = 'transform .2s ease'; el.style.transform = '' }
    setBarState(0, false);
    bar.style.pointerEvents = 'none';
    pulling = false; dragging = false;
  }, { passive: true });
})();
