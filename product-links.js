(() => {
  const PRODUCT_URLS = {
    '1': '?product=VZ-BAG-001',
    '2': '?product=VZ-SHOE-002',
    '3': '?product=VZ-SET-003'
  };

  function openFromUrl() {
    const code = new URLSearchParams(window.location.search).get('product');
    if (!code) return;
    const id = Object.keys(PRODUCT_URLS).find(key => PRODUCT_URLS[key].includes(encodeURIComponent(code)) || PRODUCT_URLS[key].includes(code));
    if (!id) return;
    const trigger = document.querySelector(`[data-product-view="${id}"]`);
    if (trigger) trigger.click();
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-product-view]');
    if (!trigger) return;
    const id = trigger.getAttribute('data-product-view');
    const path = PRODUCT_URLS[id];
    if (!path) return;
    history.pushState({ product: id }, '', path);
  });

  window.addEventListener('popstate', openFromUrl);
  const observer = new MutationObserver(openFromUrl);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(openFromUrl, 400);
})();
