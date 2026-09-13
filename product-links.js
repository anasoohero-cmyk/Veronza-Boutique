(() => {
  function openFromUrl() {
    const code = new URLSearchParams(window.location.search).get('product');
    if (!code) return;
    const trigger = document.querySelector(`[data-product-view]`);
    if (!trigger) return;
    const products = Array.isArray(window.products) ? window.products : [];
    const product = products.find(p => p.code === code);
    if (!product) return;
    const el = document.querySelector(`[data-product-view="${product.id}"]`);
    if (el) el.click();
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-product-view]');
    if (!trigger) return;
    const id = trigger.getAttribute('data-product-view');
    const products = Array.isArray(window.products) ? window.products : [];
    const product = products.find(p => String(p.id) === id);
    if (!product) return;
    const path = `?product=${encodeURIComponent(product.code)}`;
    history.pushState({ product: id }, '', path);
  });

  window.addEventListener('popstate', openFromUrl);
  window.addEventListener('productsLoaded', openFromUrl);
  setTimeout(openFromUrl, 800);
})();
