(() => {
  let startY = 0;
  let pulling = false;
  let refreshing = false;
  const threshold = 70;

  const indicator = document.createElement('div');
  indicator.textContent = '↻';
  indicator.setAttribute('aria-hidden', 'true');
  Object.assign(indicator.style, {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
    left: '50%',
    width: '34px',
    height: '34px',
    marginLeft: '-17px',
    borderRadius: '50%',
    background: '#111',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    zIndex: '99999',
    opacity: '0',
    transform: 'translateY(-55px)',
    transition: 'opacity .15s ease, transform .15s ease'
  });
  document.body.appendChild(indicator);

  const show = () => {
    indicator.style.opacity = '1';
    indicator.style.transform = 'translateY(0)';
  };
  const hide = () => {
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateY(-55px)';
  };

  document.addEventListener('touchstart', e => {
    if (refreshing || document.scrollingElement.scrollTop !== 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling || refreshing || document.scrollingElement.scrollTop !== 0) return;
    const distance = e.touches[0].clientY - startY;
    if (distance <= 0) return;
    if (distance >= threshold) show();
    else hide();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling || refreshing) return;
    pulling = false;
    const shouldRefresh = indicator.style.opacity === '1';
    hide();
    if (!shouldRefresh) return;
    refreshing = true;
    window.location.reload();
  }, { passive: true });
})();
