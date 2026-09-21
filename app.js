const WHATSAPP = '218944000974';
const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const SUPABASE_LOAD_TIMEOUT = 10000;
const PRODUCTS_CACHE_KEY = 'veronza:productsCache';
const PRODUCTS_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
let products = [];
window.products = products;
let supabaseClientPromise;
let productsLoadPromise;

function loadSupabaseClient() {
  if (supabaseClientPromise) return supabaseClientPromise;
  supabaseClientPromise = new Promise((resolve, reject) => {
    let settled = false,
      timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const create = () =>
      window.supabase?.createClient
        ? finish(resolve, window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY))
        : finish(reject, new Error('تعذر تهيئة Supabase'));
    timer = setTimeout(
      () => finish(reject, new Error('انتهت مهلة تحميل Supabase')),
      SUPABASE_LOAD_TIMEOUT,
    );
    if (window.supabase?.createClient) {
      create();
      return;
    }
    const existing = document.querySelector('script[data-supabase-js]');
    if (existing) {
      existing.addEventListener('load', create, { once: true });
      existing.addEventListener('error', () => finish(reject, new Error('تعذر تحميل Supabase')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.dataset.supabaseJs = 'true';
    script.onload = create;
    script.onerror = () => finish(reject, new Error('تعذر تحميل Supabase'));
    document.head.appendChild(script);
  }).catch((error) => {
    supabaseClientPromise = null;
    throw error;
  });
  return supabaseClientPromise;
}

function readProductsCache() {
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.products) || !parsed.products.length) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > PRODUCTS_CACHE_MAX_AGE_MS) return null;
    return parsed.products;
  } catch (_) {
    return null;
  }
}
function writeProductsCache(list) {
  try {
    localStorage.setItem(
      PRODUCTS_CACHE_KEY,
      JSON.stringify({ products: list, savedAt: Date.now() }),
    );
  } catch (_) {}
}

function showProductsError(grid) {
  if (!grid) return;
  grid.innerHTML =
    '<div style="grid-column:1/-1;text-align:center;color:#b42318;padding:24px"><p style="margin:0 0 12px">تعذر تحميل المنتجات حاليًا. حاول تحديث الصفحة.</p><button type="button" data-products-retry style="border:0;background:#111;color:#fff;padding:10px 18px;border-radius:10px;cursor:pointer">إعادة المحاولة</button></div>';
  grid
    .querySelector('[data-products-retry]')
    ?.addEventListener('click', () => loadProductsFromSupabase());
}

async function fetchProductsDirect() {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), SUPABASE_LOAD_TIMEOUT);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=id,code,name,description,price,discount_price,type,img,extra_img,rating,reviews,colors,sizes,size_quantities,quantity&is_active=eq.true&order=id.asc`,
      {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
        signal: controller.signal,
        cache: 'no-store',
      },
    );
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid products response');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function loadProductsFromSupabase() {
  if (productsLoadPromise) return productsLoadPromise;
  const grid = document.querySelector('#productGrid');
  // Show the last known products immediately (before the network request
  // even goes out) so the page never sits on a blank loading state on a
  // slow connection - the real fetch below still runs right away and
  // silently replaces this the moment it resolves.
  if (!products.length) {
    const cached = readProductsCache();
    if (cached) {
      products.splice(0, products.length, ...cached);
      window.products = products;
      renderProducts(products);
      window.dispatchEvent(new CustomEvent('productsLoaded'));
    } else if (grid) {
      grid.innerHTML =
        '<p style="grid-column:1/-1;text-align:center;color:#888">جاري تحميل المنتجات…</p>';
    }
  }
  productsLoadPromise = (async () => {
    try {
      let rows;
      try {
        rows = await fetchProductsDirect();
      } catch (directError) {
        console.warn('Veronza direct products:', directError);
        const client = await loadSupabaseClient();
        const result = await client
          .from('products')
          .select(
            'id,code,name,description,price,discount_price,type,img,extra_img,rating,reviews,colors,sizes,size_quantities,quantity',
          )
          .eq('is_active', true)
          .order('id', { ascending: true });
        if (result.error) throw result.error;
        rows = Array.isArray(result.data) ? result.data : [];
      }
      products.splice(
        0,
        products.length,
        ...rows.map((row) => {
          const extras = row.extra_img
            ? String(row.extra_img)
                .split(/\n+/)
                .map((x) => x.trim())
                .filter(Boolean)
            : [];
          const images = [row.img, ...extras].filter((v, i, a) => v && a.indexOf(v) === i);
          return {
            id: Number(row.id),
            code: row.code,
            name: row.name,
            description: row.description || '',
            price: Number(row.price || 0),
            discountPrice: row.discount_price != null ? Number(row.discount_price) : null,
            type: row.type,
            img: row.img,
            extraImg: extras[0] || undefined,
            images,
            rating: String(row.rating ?? 0),
            reviews: Number(row.reviews || 0),
            colors: Array.isArray(row.colors) ? row.colors : [],
            sizes: Array.isArray(row.sizes) ? row.sizes : [],
            sizeQuantities: row.size_quantities || {},
            quantity: Number(row.quantity || 0),
          };
        }),
      );
      window.products = products;
      renderProducts(products);
      writeProductsCache(products);
      window.dispatchEvent(new CustomEvent('productsLoaded'));
      return products;
    } catch (error) {
      console.error('Veronza products:', error);
      // If we already have cached products on screen, keep showing them
      // instead of replacing a perfectly usable view with an error state.
      if (!products.length) showProductsError(grid);
      return [];
    } finally {
      productsLoadPromise = null;
    }
  })();
  return productsLoadPromise;
}

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
let cart = readStorage('veronza-cart', []);
let wishlist = readStorage('veronza-wishlist', []);
let quickBuyItem = null;
window.cart = cart;
const $ = (s) => document.querySelector(s),
  $$ = (s) => document.querySelectorAll(s);
function money(n) {
  return `${Number(n || 0).toLocaleString('ar-LY')} د.ل`;
}
function hasDiscount(p) {
  return p.discountPrice != null && Number(p.discountPrice) < Number(p.price);
}
function effectivePrice(p) {
  return hasDiscount(p) ? Number(p.discountPrice) : Number(p.price || 0);
}
function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}
function productVisual(p) {
  // The two-photo "bag + shoe" collage only makes sense for an actual Set
  // bundle - every product type now supports a second photo (e.g. a back
  // angle), which isn't a bag/shoe pairing and shouldn't be shown as one.
  return p.type === 'set' && p.extraImg
    ? `<div class="set-visual"><img src="${esc(p.img)}" alt="${esc(p.name)} — الشنطة" loading="lazy"><img src="${esc(p.extraImg)}" alt="${esc(p.name)} — الحذاء" loading="lazy"></div>`
    : `<img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">`;
}
function isSizeRequired(p) {
  return p?.type === 'shoes' || p?.type === 'set';
}
function sizeStock(p, size) {
  if (!isSizeRequired(p)) return Number(p?.quantity || 0);
  const sq = p?.sizeQuantities;
  if (sq && Object.prototype.hasOwnProperty.call(sq, size)) return Number(sq[size] || 0);
  return Number(p?.quantity || 0);
}
function optionMarkup(p) {
  const sizeOptions = isSizeRequired(p)
    ? `<option value="" selected disabled>اختار المقاس</option>${p.sizes
        .map((s) => {
          const outOfStock = sizeStock(p, s) <= 0;
          return `<option value="${esc(s)}"${outOfStock ? ' disabled' : ''}>${esc(s)}${outOfStock ? ' (نفذت)' : ''}</option>`;
        })
        .join('')}`
    : `<option value="موحد" selected>موحد</option>`;
  return `<div class="product-options"><label>اللون<select data-color="${p.id}">${p.colors.map((c, i) => `<option value="${esc(c)}"${i === 0 ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label>المقاس<select data-size="${p.id}"${isSizeRequired(p) ? ' required' : ''}>${sizeOptions}</select></label></div>`;
}
function getSelectedSize(p, select) {
  const size = String(select?.value || '').trim();
  if (isSizeRequired(p) && !size) {
    alert('اختار المقاس أولاً.');
    select?.focus();
    return null;
  }
  return size || 'موحد';
}
let currentList = products;
function renderProducts(list = products) {
  currentList = list;
  const grid = $('#productGrid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#888;padding:24px 0">لا توجد منتجات هنا حالياً.</p>';
    return;
  }
  grid.innerHTML = list
    .map((p) => {
      const fav = wishlist.includes(p.id);
      const rating = Math.min(5, Math.max(0, Math.round(Number(p.rating) || 0)));
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      const outOfStock = Number(p.quantity || 0) <= 0;
      const discounted = hasDiscount(p);
      const priceHtml = discounted
        ? `<div class="price"><s class="price-original">${money(p.price)}</s><span class="price-discounted">${money(p.discountPrice)}</span></div>`
        : `<div class="price">${money(p.price)}</div>`;
      const badgeHtml = outOfStock
        ? '<span class="soldout-badge">نفذت الكمية</span>'
        : discounted
          ? '<span class="discount-badge">خصم</span>'
          : p.type === 'set'
            ? '<span class="set-badge">سيت كامل</span>'
            : '';
      const descHtml = p.description
        ? `<div class="product-desc">${esc(p.description)}</div>`
        : '';
      return `<article class="product${outOfStock ? ' out-of-stock' : ''}"><div class="product-img" data-product-view="${p.id}" role="button" tabindex="0" aria-label="عرض تفاصيل ${esc(p.name)}">${productVisual(p)}<button class="heart ${fav ? 'is-fav' : ''}" data-fav="${p.id}" aria-label="${fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">${fav ? '♥' : '♡'}</button>${badgeHtml}</div><div class="product-info"><button class="product-name product-name-button" data-product-view="${p.id}">${esc(p.name)}</button>${descHtml}${priceHtml}<div class="stars">${stars} <span>(${p.reviews})</span></div>${optionMarkup(p)}<button class="add" data-add="${p.id}"${outOfStock ? ' disabled' : ''}>${outOfStock ? 'نفذت الكمية' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg> أضف إلى السلة'}</button></div></article>`;
    })
    .join('');
  $$('[data-add]').forEach(
    (b) =>
      (b.onclick = () => {
        const id = Number(b.dataset.add),
          p = products.find((x) => x.id === id),
          size = getSelectedSize(p, $(`[data-size="${id}"]`));
        if (size === null) return;
        addToCart(id, $(`[data-color="${id}"]`).value, size);
      }),
  );
  $$('[data-fav]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        toggleWishlist(Number(b.dataset.fav));
      }),
  );
  $$('[data-product-view]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('[data-fav]')) return;
      openProductDetails(Number(el.dataset.productView));
    };
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openProductDetails(Number(el.dataset.productView));
      }
    };
  });
}
function save() {
  localStorage.setItem('veronza-cart', JSON.stringify(cart));
}
function saveWishlist() {
  localStorage.setItem('veronza-wishlist', JSON.stringify(wishlist));
}
function toggleWishlist(id) {
  const adding = !wishlist.includes(id);
  wishlist = adding ? [...wishlist, id] : wishlist.filter((x) => x !== id);
  window.wishlist = wishlist;
  saveWishlist();
  renderProducts(currentList);
  updateWishlistCount();
  syncWishlistToggle(id, adding);
}
function updateWishlistCount() {
  const fav = $('[data-wishlist-count]');
  if (fav) fav.textContent = wishlist.length;
}
async function syncWishlistToggle(productId, adding) {
  const client = window.veronzaSupabase;
  if (!client) return;
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) return;
    if (adding)
      await client
        .from('wishlist_items')
        .insert({ user_id: session.user.id, product_id: productId });
    else
      await client
        .from('wishlist_items')
        .delete()
        .eq('user_id', session.user.id)
        .eq('product_id', productId);
  } catch (_) {}
}
window.setWishlist = (ids) => {
  wishlist = Array.isArray(ids) ? [...new Set(ids)] : [];
  window.wishlist = wishlist;
  saveWishlist();
  renderProducts(currentList);
  updateWishlistCount();
};
window.wishlist = wishlist;
function addToCartCore(id, color, size, qty = 1) {
  const p = products.find((x) => x.id === id);
  if (!p) return false;
  if (isSizeRequired(p) && !size) {
    alert('اختار المقاس أولاً.');
    return false;
  }
  const q = Math.max(1, Number(qty) || 1);
  const existing = cart.find((x) => x.id === id && x.color === color && x.size === size);
  const currentQty = existing ? existing.qty : 0;
  const stock = sizeStock(p, size);
  if (currentQty + q > stock) {
    alert(stock <= 0 ? 'عذراً، هذا المنتج نفذ من المخزون حالياً.' : `الكمية المتوفرة: ${stock}.`);
    return false;
  }
  if (existing) {
    existing.qty = currentQty + q;
    existing.selected = true;
  } else {
    cart.push({ ...p, price: effectivePrice(p), qty: q, color, size, selected: true });
  }
  save();
  renderCart();
  return true;
}
function addToCart(id, color, size, qty = 1) {
  if (addToCartCore(id, color, size, qty)) openCart();
}
function renderCart() {
  const box = $('[data-cart-items]');
  if (!box) return;
  const selected = cart.filter((x) => x.selected !== false);
  const count = cart.reduce((s, x) => s + x.qty, 0),
    total = selected.reduce((s, x) => s + x.price * x.qty, 0);
  const totalEl = $('[data-cart-total]');
  if (totalEl) totalEl.textContent = money(total);
  const bagCount = $('.bag span');
  if (bagCount) bagCount.textContent = count;
  const selectAllRow = $('[data-select-all-row]');
  const selectAllBox = $('[data-select-all]');
  if (selectAllRow) selectAllRow.hidden = cart.length < 2;
  if (selectAllBox) selectAllBox.checked = cart.length > 0 && selected.length === cart.length;
  box.innerHTML = cart.length
    ? cart
        .map(
          (x, i) =>
            `<div class="cart-row"><label class="cart-row-select"><input type="checkbox" data-select="${i}" ${x.selected !== false ? 'checked' : ''} aria-label="اختيار ${esc(x.name)} للشراء الآن"></label><img src="${esc(x.img)}" alt="${esc(x.name)}" class="cart-thumb"><div class="cart-row-info"><strong>${esc(x.name)}</strong><div>الكود: ${esc(x.code)}</div><div>اللون: ${esc(x.color)}${isSizeRequired(x) ? ' · المقاس: ' + esc(x.size) : ''}</div><div>${money(x.price * x.qty)}</div><div class="qty-controls"><button type="button" data-qty="${i}" data-dir="-1" aria-label="تقليل الكمية">−</button><span>${x.qty}</span><button type="button" data-qty="${i}" data-dir="1" aria-label="زيادة الكمية">+</button></div></div><button type="button" data-remove="${i}" class="cart-remove" aria-label="حذف المنتج">×</button></div>`,
        )
        .join('')
    : '<p style="color:#888;text-align:center">السلة فارغة حالياً.</p>';
  $$('[data-select]').forEach(
    (cb) =>
      (cb.onchange = () => {
        const i = Number(cb.dataset.select);
        if (cart[i]) cart[i].selected = cb.checked;
        save();
        renderCart();
      }),
  );
  $$('[data-remove]').forEach(
    (b) =>
      (b.onclick = () => {
        cart.splice(Number(b.dataset.remove), 1);
        save();
        renderCart();
      }),
  );
  $$('[data-qty]').forEach(
    (b) =>
      (b.onclick = () => {
        const i = Number(b.dataset.qty);
        if (!cart[i]) return;
        cart[i].qty += Number(b.dataset.dir);
        if (cart[i].qty < 1) cart.splice(i, 1);
        save();
        renderCart();
      }),
  );
}
// Covers every overlay on the site regardless of which script manages it, so
// closing one doesn't unlock scrolling while another is still open (e.g. the
// image lightbox inside the still-open product modal, or the chat panel
// opened from a page that owns other modals). Re-run after any open/close.
//
// overflow:hidden alone doesn't reliably block touch-driven scrolling on
// some mobile browsers (the background page could still be dragged behind
// an open sheet) - pinning the body with position:fixed at its current
// scroll offset is the technique that actually holds there too.
let vzScrollLockY = 0;
function syncBodyScrollLock() {
  const anyOpen = !!document.querySelector(
    '.cart-drawer.open,.search-panel.open,.mobile-menu.open,.product-details-modal.open,.veronza-lightbox.open,[data-checkout-modal].open,.auth-modal.open,.order-ready.open,.vz-chat-panel.open',
  );
  const isLocked = document.body.style.position === 'fixed';
  if (anyOpen && !isLocked) {
    vzScrollLockY = window.scrollY;
    Object.assign(document.body.style, {
      position: 'fixed',
      top: `-${vzScrollLockY}px`,
      left: '0',
      right: '0',
      width: '100%',
    });
  } else if (!anyOpen && isLocked) {
    Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, vzScrollLockY);
  }
}
window.syncBodyScrollLock = syncBodyScrollLock;
function openLayer(el) {
  if (!el) return;
  el.classList.add('open');
  $('.overlay')?.classList.add('show');
  syncBodyScrollLock();
}
function closeLayers() {
  $$('.mobile-menu,.search-panel,.cart-drawer').forEach((x) => x.classList.remove('open'));
  $('.overlay')?.classList.remove('show');
  syncBodyScrollLock();
}
function openCart() {
  closeLayers();
  openLayer($('[data-cart-drawer]'));
}
function whatsappMessage(customer, items = cart) {
  const lines = items.map(
      (x) =>
        `• ${x.name}\n  الكود: ${x.code}\n  اللون: ${x.color}${isSizeRequired(x) ? '\n  المقاس: ' + x.size : ''}\n  الكمية: ${x.qty}\n  السعر: ${money(x.price * x.qty)}\n  الصورة: ${x.img}`,
    ),
    total = items.reduce((s, x) => s + x.price * x.qty, 0);
  return `السلام عليكم، نبي نطلب من Veronza Boutique\n\n${lines.join('\n\n')}\n\nالإجمالي: ${money(total)}\n\nبيانات الزبون:\nالاسم: ${customer.name}\nرقم الهاتف: ${customer.phone}\nالعنوان: ${customer.address}`;
}
function openWhatsApp(message) {
  window.location.href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;
}
let orderReadyMessage = '';
function ensureOrderReadySheet() {
  if ($('[data-order-ready]')) return;
  const style = document.createElement('style');
  style.textContent =
    '.order-ready{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:110;padding:16px}.order-ready.open{display:flex}.order-ready-card{position:relative;width:min(92vw,420px);max-height:88vh;overflow:auto;background:#fff;padding:24px;border-radius:24px;box-shadow:0 20px 50px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:16px}.order-ready-close{position:absolute;top:16px;inset-inline-start:16px;width:34px;height:34px;border-radius:50%;border:0;background:#f4f1ec;color:#73706b;font-size:18px;line-height:1;cursor:pointer}.order-ready-icon{width:46px;height:46px;border-radius:50%;background:#eaf9f0;display:flex;align-items:center;justify-content:center}.order-ready-card h2{margin:0;font-size:19px;font-weight:800}.order-ready-sub{margin:0;font-size:13px;color:#73706b;line-height:1.8}.order-ready-items{display:flex;flex-direction:column;gap:10px}.order-ready-row{border:1px solid #e8e2d8;border-radius:14px;padding:10px;display:flex;gap:12px;align-items:center}.order-ready-thumb{width:48px;height:48px;border-radius:10px;object-fit:cover;flex:none;background:#f7f3ed;border:1px solid #e8e2d8}.order-ready-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.order-ready-info strong{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.order-ready-info span{font-size:11.5px;color:#73706b}.order-ready-price{font-family:"Playfair Display",Cairo,serif;font-weight:700;font-size:14px;white-space:nowrap}.order-ready-cta{display:flex;align-items:center;justify-content:center;gap:10px;background:#25d366;color:#fff;border:0;border-radius:14px;padding:15px;font:inherit;font-weight:800;font-size:15px;cursor:pointer}.order-ready-cta svg{width:20px;height:20px;flex:none}';
  document.head.appendChild(style);
  const sheet = document.createElement('div');
  sheet.className = 'order-ready';
  sheet.setAttribute('data-order-ready', '');
  sheet.innerHTML =
    '<div class="order-ready-card"><button type="button" class="order-ready-close" data-order-ready-close aria-label="إغلاق">×</button><div class="order-ready-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#128c4a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 14.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.08-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z"/><path d="M12.05 21.79A9.9 9.9 0 0 1 7 20.4l-.36-.21-3.74.98 1-3.65-.24-.37A9.86 9.86 0 1 1 22 11.9c0 5.45-4.44 9.88-9.88 9.88Z"/></svg></div><h2>طلبك جاهز ✓</h2><p class="order-ready-sub">مزال خطوة وحدة بسيطة — اضغط الزر الأخضر تحت متع واتساب لإرسال طلبك وإتمامه عبر واتساب.</p><div class="order-ready-items" data-order-ready-items></div><button type="button" class="order-ready-cta" data-order-ready-cta><svg viewBox="0 0 24 24" fill="#fff"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.08-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.7.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35ZM12.05 21.78a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.74.98 1-3.65-.24-.37a9.86 9.86 0 1 1 8.38 4.64Zm0-18.33A11.87 11.87 0 0 0 0 15.32c0 2.1.55 4.14 1.59 5.94L0 24l6.31-1.65a11.87 11.87 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.9-11.89a11.8 11.8 0 0 0-3.48-8.43Z"/></svg>إرسال طلبك عبر واتساب</button></div>';
  document.body.appendChild(sheet);
  sheet.querySelector('[data-order-ready-close]').onclick = closeOrderReadySheet;
  sheet.onclick = (e) => {
    if (e.target === sheet) closeOrderReadySheet();
  };
  sheet.querySelector('[data-order-ready-cta]').onclick = () => {
    openWhatsApp(orderReadyMessage);
    closeOrderReadySheet();
  };
  attachSwipeDownToClose(sheet.querySelector('.order-ready-card'), closeOrderReadySheet);
}
function openOrderReadySheet(customer, items) {
  ensureOrderReadySheet();
  orderReadyMessage = whatsappMessage(customer, items);
  $('[data-order-ready-items]').innerHTML = items
    .map(
      (x) =>
        `<div class="order-ready-row"><img src="${esc(x.img)}" alt="${esc(x.name)}" class="order-ready-thumb"><div class="order-ready-info"><strong>${esc(x.name)}</strong><span>الكود ${esc(x.code)}${x.color ? ' · ' + esc(x.color) : ''}${isSizeRequired(x) && x.size ? ' · المقاس ' + esc(x.size) : ''}</span></div><div class="order-ready-price">${money(x.price * x.qty)}</div></div>`,
    )
    .join('');
  $('[data-order-ready]').classList.add('open');
  syncBodyScrollLock();
}
function closeOrderReadySheet() {
  $('[data-order-ready]')?.classList.remove('open');
  syncBodyScrollLock();
}
async function sendOrderToCloudAPI(customer, items = cart) {
  const total = items.reduce((s, x) => s + x.price * x.qty, 0);
  const response = await fetch('/api/send-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer,
      items: items.map((x) => ({
        code: x.code,
        name: x.name,
        color: x.color,
        size: isSizeRequired(x) ? x.size : '',
        qty: x.qty,
        price: x.price,
        img: x.img,
        type: x.type,
      })),
      total,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'WhatsApp API failed');
  return data;
}

async function validateCartStock(items = cart) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), SUPABASE_LOAD_TIMEOUT);
  try {
    const payload = { p_items: items.map((x) => ({ product_code: x.code, quantity: x.qty })) };
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_cart_stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, results: null };
    const results = await response.json();
    return { ok: true, results };
  } catch (error) {
    return { ok: false, results: null };
  } finally {
    clearTimeout(timer);
  }
}
function openCheckout(isQuickBuy = false) {
  if (!isQuickBuy) {
    quickBuyItem = null;
    if (!cart.length) {
      alert('أضف منتجاً إلى السلة أولاً.');
      return;
    }
    if (!cart.some((x) => x.selected !== false)) {
      alert('اختار منتجاً واحداً على الأقل من السلة لشرائه.');
      return;
    }
  }
  const modal = $('[data-checkout-modal]');
  if (modal) modal.classList.add('open');
  syncBodyScrollLock();
  const items = isQuickBuy ? [quickBuyItem] : cart.filter((x) => x.selected !== false);
  window.fbq?.('track', 'InitiateCheckout', {
    content_ids: items.map((x) => String(x.id)),
    content_type: 'product',
    value: items.reduce((s, x) => s + x.price * x.qty, 0),
    currency: 'LYD',
    num_items: items.reduce((s, x) => s + x.qty, 0),
  });
}
function closeCheckout() {
  $('[data-checkout-modal]')?.classList.remove('open');
  quickBuyItem = null;
  syncBodyScrollLock();
}
// Swipe-down-to-close for a bottom sheet / dialog card. Works whether the
// card is positioned with plain flexbox (no base transform) or already uses
// a transform for its own open/closed state (e.g. translateX(-50%) sheets) —
// it reads whatever transform is in effect when the drag starts and layers
// the drag offset on top of it, instead of overwriting it.
function attachSwipeDownToClose(card, closeFn, { scrollEl } = {}) {
  const scroller = scrollEl || card;
  let startX = 0,
    startY = 0,
    dragging = false,
    moved = false,
    scrollTopAtStart = 0,
    startedInScroller = true,
    baseTransform = '';
  const setOffset = (dy) => {
    card.style.transform = baseTransform ? `${baseTransform} translateY(${dy}px)` : `translateY(${dy}px)`;
  };
  const start = (e) => {
    const p = e.touches[0];
    startX = p.clientX;
    startY = p.clientY;
    // The "must be scrolled to top" guard below only makes sense for a
    // drag that actually starts inside the scrollable area (there it
    // disambiguates "scroll back up" from "close"). A drag starting on
    // the header/footer chrome has no such ambiguity - e.g. a chat panel
    // whose message list is auto-scrolled to the bottom should still
    // close on a swipe started from its header.
    startedInScroller = scroller === card || scroller.contains(e.target);
    scrollTopAtStart = scroller.scrollTop;
    dragging = true;
    moved = false;
    const computed = getComputedStyle(card).transform;
    baseTransform = computed && computed !== 'none' ? computed : '';
    card.style.transition = 'none';
  };
  const move = (e) => {
    if (!dragging) return;
    const p = e.touches[0];
    const dx = p.clientX - startX,
      dy = p.clientY - startY;
    if (!moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    // Only take over for a clearly-vertical, downward drag while the sheet
    // is scrolled to the top — otherwise leave it to normal scrolling or
    // the image gallery's own horizontal swipe.
    if (!moved && (Math.abs(dx) >= Math.abs(dy) || dy < 0 || (startedInScroller && scrollTopAtStart > 0))) {
      dragging = false;
      return;
    }
    moved = true;
    if (e.cancelable) e.preventDefault();
    setOffset(dy);
  };
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) return;
    const p = e.changedTouches[0];
    const dy = p.clientY - startY;
    card.style.transition = 'transform .2s ease';
    if (dy > 90) {
      setOffset(window.innerHeight);
      setTimeout(() => {
        closeFn();
        card.style.transition = '';
        card.style.transform = '';
      }, 180);
    } else {
      card.style.transform = '';
      setTimeout(() => {
        card.style.transition = '';
      }, 200);
    }
  };
  card.addEventListener('touchstart', start, { passive: true });
  card.addEventListener('touchmove', move, { passive: false });
  card.addEventListener('touchend', end);
}
function ensureProductModal() {
  if ($('#productDetailsModal')) return;
  const style = document.createElement('style');
  style.textContent =
    '.product-name-button{display:block;width:100%;padding:0;border:0;background:none;text-align:right;cursor:pointer}.product-details-modal{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:flex-end;justify-content:center;z-index:90}.product-details-modal.open{display:flex}.product-details-card{width:min(100%,680px);max-height:94vh;overflow:auto;overscroll-behavior:contain;background:#fff;border-radius:24px 24px 0 0;padding:18px}.product-details-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.product-details-close{border:0;background:#f4f1ec;width:40px;height:40px;border-radius:50%;font-size:25px}.product-details-media{aspect-ratio:1/1;background:#f5f2ed;overflow:hidden}.product-details-media img{width:100%;height:100%;object-fit:cover}.product-details-media.set{display:grid;grid-template-columns:1fr 1fr;gap:2px}.product-details-info h2{font-size:22px;margin:14px 0 4px}.product-details-code{color:#888;font-size:11px}.product-details-description{color:#555;font-size:13px;line-height:1.7;margin:8px 0}.product-details-price{font-family:"Playfair Display",serif;font-size:24px;font-weight:700;margin:8px 0}.product-details-rating{color:#b58a3b;font-size:12px}.detail-options{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.detail-options label{display:grid;gap:6px;font-size:12px;font-weight:700}.detail-options select{padding:11px;border:1px solid #ddd8d0;border-radius:10px;background:#fff}.detail-qty{display:flex;align-items:center;justify-content:space-between;border:1px solid #ddd8d0;border-radius:10px;padding:5px 10px;margin-bottom:12px}.detail-qty button{border:0;background:#f4f1ec;width:34px;height:34px;border-radius:8px;font-size:20px}.detail-qty span{font-weight:700}.detail-add{width:100%;border:0;background:#111;color:#fff;padding:14px;border-radius:12px;font-weight:800}.detail-add:hover{background:#b58a3b}.detail-buy-now{width:100%;border:2px solid #111;background:#fff;color:#111;padding:13px;border-radius:12px;font-weight:800;margin-top:10px}.detail-buy-now:hover{background:#111;color:#fff}.product-gallery{position:relative}.gallery-main{aspect-ratio:1/1;background:#f5f2ed;overflow:hidden;position:relative;cursor:zoom-in;direction:ltr}.gallery-track{display:flex;height:100%;width:100%;touch-action:pan-y}.gallery-track img{width:100%;height:100%;object-fit:cover;display:block;flex-shrink:0;user-select:none;-webkit-user-drag:none;pointer-events:none}.gallery-counter{position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:4px 11px;border-radius:20px;pointer-events:none}.gallery-nav{position:absolute;top:0;bottom:0;width:34%;background:none;border:0}.gallery-nav.prev{left:0}.gallery-nav.next{right:0}.gallery-dots{display:flex;gap:6px;justify-content:center;margin-top:10px}.gallery-dots button{width:7px;height:7px;padding:0;border-radius:50%;background:#ddd8d0;border:0}.gallery-dots button.active{background:#111;width:18px;border-radius:5px}.veronza-lightbox{position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;z-index:200;opacity:0;pointer-events:none;transition:opacity .22s ease}.veronza-lightbox.open{opacity:1;pointer-events:auto}.lightbox-track{display:flex;height:85vh;width:100%;touch-action:pan-y;direction:ltr}.lightbox-track img{width:100%;height:100%;object-fit:contain;flex-shrink:0;user-select:none;-webkit-user-drag:none;pointer-events:none}.lightbox-close{position:absolute;top:18px;inset-inline-start:18px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;border:0;font-size:24px;line-height:1;z-index:2}.lightbox-counter{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;background:rgba(255,255,255,.15);padding:5px 14px;border-radius:20px;z-index:2}.lightbox-nav{position:absolute;top:0;bottom:0;width:40%;background:none;border:0;z-index:1}.lightbox-nav.prev{left:0}.lightbox-nav.next{right:0}.product-details-share{border:0;background:#f4f1ec;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;margin-inline-end:8px}@media(min-width:901px){.product-details-modal{align-items:center}.product-details-card{border-radius:24px}}';
  document.head.appendChild(style);
  const modal = document.createElement('div');
  modal.id = 'productDetailsModal';
  modal.className = 'product-details-modal';
  modal.innerHTML =
    '<div class="product-details-card"><div class="product-details-head"><strong>تفاصيل المنتج</strong><div style="display:flex;align-items:center"><button type="button" class="product-details-share" data-detail-call aria-label="اتصال"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></button><button type="button" class="product-details-share" data-detail-share aria-label="نسخ رابط المنتج"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7l7.8-4.4M8.1 13.3l7.8 4.4"/></svg></button><button type="button" class="product-details-close" aria-label="إغلاق">×</button></div></div><div class="product-gallery" data-gallery><div class="gallery-main" data-gallery-main><div class="gallery-track" data-gallery-track></div><span class="gallery-counter" data-gallery-counter hidden></span><button type="button" class="gallery-nav prev" data-gallery-prev aria-label="السابق" hidden></button><button type="button" class="gallery-nav next" data-gallery-next aria-label="التالي" hidden></button></div><div class="gallery-dots" data-gallery-dots></div></div><div class="product-details-info"><h2 data-detail-name></h2><div class="product-details-description" data-detail-description hidden></div><div class="product-details-code" data-detail-code></div><div class="product-details-price" data-detail-price></div><div class="product-details-rating" data-detail-rating></div><div class="detail-options"><label>اللون<select data-detail-color></select></label><label>المقاس<select data-detail-size></select></label></div><div class="detail-qty"><button type="button" data-detail-minus>−</button><span data-detail-qty>1</span><button type="button" data-detail-plus>+</button></div><button type="button" class="detail-add" data-detail-add>أضف إلى السلة</button><button type="button" class="detail-buy-now" data-detail-buy>اطلب الآن (شراء مباشر)</button><section class="social-row" style="margin-top:16px"><a href="https://www.tiktok.com/@veronzashoes?_r=1&_t=ZS-99lnIqS3wX7" target="_blank" rel="noopener noreferrer"><span class="icon-badge badge-tiktok"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></span><strong>تيك توك</strong></a><a href="https://www.facebook.com/share/1BtiAsrbyz/" target="_blank" rel="noopener noreferrer"><span class="icon-badge badge-facebook"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></span><strong>فيسبوك</strong></a><a href="https://www.snapchat.com/add/veronzashoes?share_id=om3g8utASEc&locale=en-US" target="_blank" rel="noopener noreferrer"><span class="icon-badge badge-snapchat"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z"/></svg></span><strong>سناب شات</strong></a><a href="https://www.instagram.com/veronzashoes?utm_source=qr&stkn=MTJ3bjIwdmxrdzJxNw==" target="_blank" rel="noopener noreferrer"><span class="icon-badge badge-instagram"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg></span><strong>انستقرام</strong></a><a href="https://m.me/1201339006407192" target="_blank" rel="noopener noreferrer"><span class="icon-badge badge-messenger"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13"/></svg></span><strong>ماسنجر</strong></a></section></div></div>';
  document.body.appendChild(modal);
  const lightbox = document.createElement('div');
  lightbox.className = 'veronza-lightbox';
  lightbox.innerHTML =
    '<button type="button" class="lightbox-close" data-lb-close aria-label="إغلاق">×</button><div class="lightbox-track" data-lb-track></div><span class="lightbox-counter" data-lb-counter hidden></span><button type="button" class="lightbox-nav prev" data-lb-prev aria-label="السابق" hidden></button><button type="button" class="lightbox-nav next" data-lb-next aria-label="التالي" hidden></button>';
  document.body.appendChild(lightbox);
  const galleryState = { images: [], index: 0 };
  const galleryTrack = modal.querySelector('[data-gallery-track]');
  const lbTrack = lightbox.querySelector('[data-lb-track]');
  const buildTrack = (track, images, name) => {
    track.innerHTML = images
      .map((src) => `<img src="${esc(src)}" alt="${esc(name || '')}" draggable="false">`)
      .join('');
  };
  const setTrackPos = (track, index, animate, extraPx = 0) => {
    track.style.transition = animate ? 'transform .28s cubic-bezier(.22,.68,0,1)' : 'none';
    track.style.transform = `translateX(calc(${-index * 100}% + ${extraPx}px))`;
  };
  const updateChrome = () => {
    const { images, index } = galleryState;
    const counters = [
      modal.querySelector('[data-gallery-counter]'),
      lightbox.querySelector('[data-lb-counter]'),
    ];
    counters.forEach((c) => {
      if (images.length > 1) {
        c.hidden = false;
        c.textContent = `${index + 1} / ${images.length}`;
      } else {
        c.hidden = true;
      }
    });
    modal.querySelector('[data-gallery-prev]').hidden = images.length < 2;
    modal.querySelector('[data-gallery-next]').hidden = images.length < 2;
    lightbox.querySelector('[data-lb-prev]').hidden = images.length < 2;
    lightbox.querySelector('[data-lb-next]').hidden = images.length < 2;
    modal.querySelector('[data-gallery-dots]').innerHTML =
      images.length > 1
        ? images
            .map(
              (_, i) =>
                `<button type="button" data-dot="${i}" class="${i === index ? 'active' : ''}" aria-label="صورة ${i + 1}"></button>`,
            )
            .join('')
        : '';
    modal.querySelectorAll('[data-dot]').forEach(
      (b) =>
        (b.onclick = () => {
          galleryState.index = Number(b.dataset.dot);
          goTo(galleryState.index);
        }),
    );
  };
  const goTo = (index, animate = true) => {
    const n = galleryState.images.length;
    if (!n) return;
    galleryState.index = (index + n) % n;
    setTrackPos(galleryTrack, galleryState.index, animate);
    setTrackPos(lbTrack, galleryState.index, animate);
    updateChrome();
  };
  const renderGallery = () => {
    buildTrack(
      galleryTrack,
      galleryState.images,
      modal.querySelector('[data-detail-name]').textContent,
    );
    buildTrack(lbTrack, galleryState.images, modal.querySelector('[data-detail-name]').textContent);
    goTo(galleryState.index, false);
  };
  const moveGallery = (dir) => goTo(galleryState.index + dir);
  modal.querySelector('[data-gallery-prev]').onclick = (e) => {
    e.stopPropagation();
    moveGallery(-1);
  };
  modal.querySelector('[data-gallery-next]').onclick = (e) => {
    e.stopPropagation();
    moveGallery(1);
  };
  const openLightbox = () => {
    if (!galleryState.images.length) return;
    setTrackPos(lbTrack, galleryState.index, false);
    lightbox.classList.add('open');
    // No separate lock/unlock here — the lightbox only ever opens from
    // inside the already-open (and already-locked) product details modal,
    // so scroll should stay locked as long as that modal is still open.
    syncBodyScrollLock();
  };
  const closeLightbox = () => {
    lightbox.classList.remove('open');
    syncBodyScrollLock();
  };
  lightbox.querySelector('[data-lb-close]').onclick = closeLightbox;
  lightbox.querySelector('[data-lb-prev]').onclick = () => moveGallery(-1);
  lightbox.querySelector('[data-lb-next]').onclick = () => moveGallery(1);
  let lbTapMoved = false;
  lightbox.onclick = (e) => {
    if (e.target === lightbox && !lbTapMoved) closeLightbox();
  };
  const attachSwipe = (el, track, { onTap, axisLock } = {}) => {
    let startX = 0,
      startY = 0,
      dragging = false,
      moved = false,
      width = 1;
    const point = (e) => (e.touches ? e.touches[0] : e);
    const start = (e) => {
      const p = point(e);
      startX = p.clientX;
      startY = p.clientY;
      dragging = true;
      moved = false;
      width = el.getBoundingClientRect().width || 1;
      track.style.transition = 'none';
    };
    const move = (e) => {
      if (!dragging) return;
      const p = point(e);
      const dx = p.clientX - startX,
        dy = p.clientY - startY;
      if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (axisLock && Math.abs(dy) > Math.abs(dx) && !moved) {
        dragging = false;
        return;
      }
      moved = true;
      if (e.cancelable) e.preventDefault();
      setTrackPos(track, galleryState.index, false, dx);
    };
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        onTap && onTap();
        return;
      }
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - startX;
      const threshold = Math.min(80, width * 0.18);
      if (dx <= -threshold) moveGallery(1);
      else if (dx >= threshold) moveGallery(-1);
      else goTo(galleryState.index);
      lbTapMoved = true;
      setTimeout(() => {
        lbTapMoved = false;
      }, 50);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('mousedown', start);
    window.addEventListener('mousemove', (e) => {
      if (dragging) move(e);
    });
    window.addEventListener('mouseup', (e) => {
      if (dragging) end(e);
    });
  };
  attachSwipe(modal.querySelector('[data-gallery-main]'), galleryTrack, {
    onTap: openLightbox,
    axisLock: true,
  });
  attachSwipe(lightbox, lbTrack, { axisLock: true });
  attachSwipeDownToClose(lightbox, closeLightbox);
  modal._galleryState = galleryState;
  modal._renderGallery = renderGallery;
  modal.querySelector('[data-detail-share]').onclick = () =>
    copyProductLink(Number(modal.dataset.productId));
  modal.querySelector('[data-detail-call]').onclick = () => {
    window.VeronzaCall?.showChoice({
      phone: '+' + WHATSAPP,
      onInSite: () => {
        closeProductDetails();
        window.veronzaStartInSiteCall?.();
      },
    });
  };
  modal.querySelector('.product-details-close').onclick = closeProductDetails;
  attachSwipeDownToClose(modal.querySelector('.product-details-card'), closeProductDetails);
  modal.onclick = (e) => {
    if (e.target === modal) closeProductDetails();
  };
  modal.querySelector('[data-detail-minus]').onclick = () => {
    const q = modal.querySelector('[data-detail-qty]');
    q.textContent = Math.max(1, Number(q.textContent) - 1);
  };
  modal.querySelector('[data-detail-plus]').onclick = () => {
    const q = modal.querySelector('[data-detail-qty]');
    q.textContent = Number(q.textContent) + 1;
  };
  const readSelection = () => {
    const id = Number(modal.dataset.productId),
      p = products.find((x) => Number(x.id) === id),
      q = Number(modal.querySelector('[data-detail-qty]').textContent) || 1,
      size = getSelectedSize(p, modal.querySelector('[data-detail-size]'));
    return { id, p, q, size, color: modal.querySelector('[data-detail-color]').value };
  };
  modal.querySelector('[data-detail-add]').onclick = () => {
    const { id, p, size, q, color } = readSelection();
    if (size === null) return;
    addToCart(id, color, size, q);
    window.fbq?.('track', 'AddToCart', {
      content_ids: [String(id)],
      content_type: 'product',
      value: effectivePrice(p) * q,
      currency: 'LYD',
    });
    closeProductDetails();
  };
  modal.querySelector('[data-detail-buy]').onclick = () => {
    const { id, size, q, color } = readSelection();
    if (size === null) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const stock = sizeStock(p, size);
    if (q > stock) {
      alert(stock <= 0 ? 'عذراً، هذا المنتج نفذ من المخزون حالياً.' : `الكمية المتوفرة: ${stock}.`);
      return;
    }
    quickBuyItem = { ...p, price: effectivePrice(p), qty: q, color, size };
    closeProductDetails();
    openCheckout(true);
  };
}
function openProductDetails(id, updateUrl = true) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  ensureProductModal();
  const modal = $('#productDetailsModal');
  modal.dataset.productId = id;
  modal.querySelector('[data-detail-name]').textContent = p.name;
  modal._galleryState.images = (p.images && p.images.length ? p.images : [p.img]).filter(Boolean);
  modal._galleryState.index = 0;
  modal._renderGallery();
  const descEl = modal.querySelector('[data-detail-description]');
  descEl.textContent = p.description || '';
  descEl.hidden = !p.description;
  modal.querySelector('[data-detail-code]').textContent = `كود المنتج: ${p.code}`;
  modal.querySelector('[data-detail-price]').innerHTML = hasDiscount(p)
    ? `<s class="price-original">${money(p.price)}</s><span class="price-discounted">${money(p.discountPrice)}</span>`
    : money(p.price);
  const dr = Math.min(5, Math.max(0, Math.round(Number(p.rating) || 0)));
  modal.querySelector('[data-detail-rating]').textContent =
    `${'★'.repeat(dr)}${'☆'.repeat(5 - dr)} ${p.rating} · ${p.reviews} تقييم`;
  modal.querySelector('[data-detail-color]').innerHTML = p.colors
    .map((x, i) => `<option value="${esc(x)}"${i === 0 ? ' selected' : ''}>${esc(x)}</option>`)
    .join('');
  const sizeSelect = modal.querySelector('[data-detail-size]');
  sizeSelect.innerHTML = isSizeRequired(p)
    ? `<option value="" selected disabled>اختار المقاس</option>${p.sizes
        .map((x) => {
          const outOfStock = sizeStock(p, x) <= 0;
          return `<option value="${esc(x)}"${outOfStock ? ' disabled' : ''}>${esc(x)}${outOfStock ? ' (نفذت)' : ''}</option>`;
        })
        .join('')}`
    : `<option value="موحد" selected>موحد</option>`;
  modal.querySelector('[data-detail-qty]').textContent = '1';
  const outOfStock = Number(p.quantity || 0) <= 0;
  const addBtn = modal.querySelector('[data-detail-add]'),
    buyBtn = modal.querySelector('[data-detail-buy]');
  addBtn.disabled = outOfStock;
  buyBtn.disabled = outOfStock;
  addBtn.textContent = outOfStock ? 'نفذت الكمية' : 'أضف إلى السلة';
  buyBtn.textContent = outOfStock ? 'نفذت الكمية' : 'اطلب الآن (شراء مباشر)';
  window.fbq?.('track', 'ViewContent', {
    content_ids: [String(p.id)],
    content_type: 'product',
    value: effectivePrice(p),
    currency: 'LYD',
  });
  modal.classList.add('open');
  syncBodyScrollLock();
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('p', id);
    history.pushState({ veronzaProduct: id }, '', url);
  }
}
function closeProductDetails() {
  const modal = $('#productDetailsModal');
  if (modal) modal.classList.remove('open');
  document.querySelector('.veronza-lightbox')?.classList.remove('open');
  syncBodyScrollLock();
  if (new URLSearchParams(location.search).has('p')) {
    const url = new URL(location.href);
    url.searchParams.delete('p');
    history.replaceState({}, '', url);
  }
}
function veronzaToast(msg, ms = 2200) {
  let t = $('.veronza-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'veronza-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}
function copyProductLink(id) {
  const link = `https://veronza.vercel.app/p/${encodeURIComponent(id)}`;
  if (navigator.share) {
    navigator.share({ url: link, title: 'Veronza Boutique' }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard
      .writeText(link)
      .then(() => veronzaToast('تم نسخ رابط المنتج ✓'))
      .catch(() => veronzaToast(link));
  } else {
    prompt('انسخ رابط المنتج:', link);
  }
}
function shareSite() {
  const link = 'https://veronza.vercel.app/';
  if (navigator.share) {
    navigator.share({ url: link, title: 'Veronza Boutique' }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard
      .writeText(link)
      .then(() => veronzaToast('تم نسخ رابط الموقع ✓'))
      .catch(() => veronzaToast(link));
  } else {
    prompt('انسخ رابط الموقع:', link);
  }
}
window.addEventListener('popstate', () => {
  const id = Number(new URLSearchParams(location.search).get('p'));
  if (id && products.find((x) => x.id === id)) {
    openProductDetails(id, false);
  } else {
    const modal = $('#productDetailsModal');
    if (modal) modal.classList.remove('open');
    syncBodyScrollLock();
  }
});
window.addEventListener(
  'productsLoaded',
  () => {
    const id = Number(new URLSearchParams(location.search).get('p'));
    if (id && products.find((x) => x.id === id)) openProductDetails(id, false);
  },
  { once: true },
);
window.addEventListener(
  'productsLoaded',
  () => {
    const state = window.veronzaConsumeRestoreState?.();
    if (!state) return;
    switch (state.window) {
      case 'cart':
        openCart();
        break;
      case 'checkout':
        openCheckout(true);
        break;
      case 'mobile-menu':
        openLayer($('[data-mobile-menu]'));
        break;
      case 'search-panel':
        openLayer($('[data-search-panel]'));
        break;
      case 'auth-modal':
        window.veronzaOpenAccount?.();
        break;
      case 'chat-panel':
        window.veronzaOpenChat?.();
        break;
    }
    if (typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
  },
  { once: true },
);
$('[data-menu]').onclick = () => openLayer($('[data-mobile-menu]'));
$('[data-menu-close]').onclick = closeLayers;
$$('[data-menu-share]').forEach(
  (el) =>
    (el.onclick = (e) => {
      e.preventDefault();
      shareSite();
    }),
);
$('[data-overlay]').onclick = closeLayers;
$('[data-cart]').onclick = openCart;
$('[data-cart-close]').onclick = closeLayers;
$('[data-select-all]')?.addEventListener('change', (e) => {
  cart.forEach((x) => (x.selected = e.target.checked));
  save();
  renderCart();
});
$('[data-search]').onclick = () => {
  openLayer($('[data-search-panel]'));
  setTimeout(() => $('#searchInput')?.focus(), 250);
};
$('[data-search-close]').onclick = closeLayers;
$('#searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase(),
    results = $('#searchResults');
  if (!q) {
    results.innerHTML = '';
    return;
  }
  const matches = products.filter((p) =>
    [p.name, p.code, ...p.colors, ...p.sizes].join(' ').toLowerCase().includes(q),
  );
  results.innerHTML = matches.length
    ? matches
        .map(
          (p) =>
            `<button class="search-result" data-search-product="${p.id}"><img src="${esc(p.img)}" alt=""><span><strong>${esc(p.name)}</strong><small>${esc(p.code)} · ${money(p.price)}</small></span></button>`,
        )
        .join('')
    : '<p>لا توجد نتائج مطابقة.</p>';
  $$('[data-search-product]').forEach(
    (b) =>
      (b.onclick = () => {
        closeLayers();
        document.querySelector('#new')?.scrollIntoView({ behavior: 'smooth' });
        const id = Number(b.dataset.searchProduct);
        currentList = [products.find((p) => p.id === id)];
        renderProducts(currentList);
      }),
  );
});

$('[data-newsletter]').onsubmit = (e) => {
  e.preventDefault();
  const message = e.currentTarget.querySelector('input').value.trim();
  if (message) openWhatsApp(`السلام عليكم، نبي نتواصل مع Veronza Boutique.\nرسالتي: ${message}`);
  e.currentTarget.querySelector('input').value = '';
};
$('[data-checkout]').onclick = () => openCheckout();
$('[data-checkout-close]').onclick = closeCheckout;
attachSwipeDownToClose($('.checkout-card'), closeCheckout);
attachSwipeDownToClose($('[data-cart-drawer]'), closeLayers, {
  scrollEl: $('[data-cart-items]'),
});
attachSwipeDownToClose($('[data-mobile-menu]'), closeLayers);
// Libyan mobile numbers are 10 digits starting with 0 (e.g. 0944000974),
// or the same number with the country code instead of the leading 0
// (+218944000974). Normalizes either into a canonical form, or reports how
// many digits are still missing so the error can tell the customer exactly
// what's wrong instead of a generic "invalid phone number".
function validateLibyanPhone(raw) {
  const trimmed = String(raw || '').trim();
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00218')) digits = digits.slice(2);
  const isIntl = trimmed.replace(/[\s-]/g, '').startsWith('+218') || digits.startsWith('218');
  if (isIntl) {
    const local = digits.startsWith('218') ? digits.slice(3) : digits;
    if (local.length < 9)
      return {
        ok: false,
        message: `رقم الهاتف ناقص (${9 - local.length} رقم). لازم يكون بهذا الشكل: +218944000974`,
      };
    if (local.length > 9)
      return { ok: false, message: 'رقم الهاتف طويل أكثر من اللازم. مثال: +218944000974' };
    return { ok: true, formatted: '+218' + local };
  }
  if (!digits.startsWith('0')) digits = '0' + digits;
  if (digits.length < 10)
    return {
      ok: false,
      message: `رقم الهاتف ناقص (${10 - digits.length} رقم). لازم يكون 10 أرقام بهذا الشكل: 0944000974`,
    };
  if (digits.length > 10)
    return { ok: false, message: 'رقم الهاتف طويل أكثر من اللازم. مثال: 0944000974' };
  return { ok: true, formatted: digits };
}
// A toast that fades out on its own timer is easy to miss and, once gone,
// leaves no trace of which field was wrong - the field itself gets a red
// border and a message right under it that stays until the field is fixed.
function setFieldError(form, name, message) {
  const field = form.querySelector(`[name="${name}"]`);
  const msgEl = form.querySelector(`[data-error-for="${name}"]`);
  field?.classList.add('field-error');
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.hidden = false;
  }
}
function clearFieldError(form, name) {
  const field = form.querySelector(`[name="${name}"]`);
  const msgEl = form.querySelector(`[data-error-for="${name}"]`);
  field?.classList.remove('field-error');
  if (msgEl) msgEl.hidden = true;
}
['name', 'phone', 'address'].forEach((name) => {
  $(`[data-checkout-form] [name="${name}"]`)?.addEventListener('input', (e) => {
    clearFieldError(e.currentTarget.form, name);
  });
});
$('[data-checkout-form]').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const isQuickBuy = !!quickBuyItem;
  const orderItems = isQuickBuy ? [quickBuyItem] : cart.filter((x) => x.selected !== false);
  if (!orderItems.length) {
    veronzaToast(isQuickBuy ? 'السلة فارغة.' : 'اختار منتجاً واحداً على الأقل من السلة.');
    return;
  }
  for (const item of orderItems) {
    const p = products.find((x) => x.id === item.id);
    if (p && isSizeRequired(p) && !item.size) {
      veronzaToast(`اختار المقاس للمنتج: ${p.name}`);
      return;
    }
  }
  const customer = {
    name: form.querySelector('[name="name"]').value.trim(),
    phone: form.querySelector('[name="phone"]').value.trim(),
    address: form.querySelector('[name="address"]').value.trim(),
    marketingOptIn: form.querySelector('[name="marketing_opt_in"]').checked,
  };
  ['name', 'phone', 'address'].forEach((name) => clearFieldError(form, name));
  let firstInvalid = null;
  if (!customer.name) {
    setFieldError(form, 'name', 'اكتب اسمك الكامل.');
    firstInvalid = firstInvalid || 'name';
  }
  const phoneCheck = customer.phone ? validateLibyanPhone(customer.phone) : { ok: false };
  if (!customer.phone) {
    setFieldError(form, 'phone', 'اكتب رقم هاتفك.');
    firstInvalid = firstInvalid || 'phone';
  } else if (!phoneCheck.ok) {
    setFieldError(form, 'phone', phoneCheck.message);
    firstInvalid = firstInvalid || 'phone';
  }
  if (!customer.address) {
    setFieldError(form, 'address', 'اكتب عنوان التوصيل.');
    firstInvalid = firstInvalid || 'address';
  }
  if (firstInvalid) {
    form.querySelector(`[name="${firstInvalid}"]`).focus();
    return;
  }
  customer.phone = phoneCheck.formatted;
  const submit = form.querySelector('.checkout-submit');
  submit.disabled = true;
  submit.textContent = 'جاري التحقق من توفر المنتجات…';
  const stockCheck = await validateCartStock(orderItems);
  if (stockCheck.ok && Array.isArray(stockCheck.results)) {
    const insufficient = stockCheck.results.filter((r) => !r.sufficient);
    if (insufficient.length) {
      submit.disabled = false;
      submit.textContent = 'تأكيد الطلب';
      if (isQuickBuy) {
        quickBuyItem = null;
        closeCheckout();
        veronzaToast('عذرًا، هذا المنتج نفذت كميته حالياً. جرب منتجاً آخر.');
      } else {
        const removedNames = insufficient.map((r) => {
          const item = cart.find((x) => x.code === r.product_code);
          return item ? item.name : r.product_code;
        });
        cart = cart.filter((x) => !insufficient.some((r) => r.product_code === x.code));
        window.cart = cart;
        save();
        renderCart();
        veronzaToast(
          `عذرًا، المنتجات التالية نفذت كميتها وتم حذفها من السلة:\n${removedNames.join('\n')}\n\nراجع سلتك وأعد إرسال الطلب.`,
          4500,
        );
        if (!cart.length) closeCheckout();
      }
      return;
    }
  }
  submit.textContent = 'جاري إرسال الطلب…';
  try {
    const result = await sendOrderToCloudAPI(customer, orderItems);
    closeCheckout();
    veronzaToast(
      `تم إرسال الطلب بنجاح إلى واتساب Veronza.\nرقم الطلب: ${result.order_number}`,
      4500,
    );
    window.fbq?.('track', 'Purchase', {
      content_ids: orderItems.map((x) => String(x.id)),
      content_type: 'product',
      value: orderItems.reduce((s, x) => s + x.price * x.qty, 0),
      currency: 'LYD',
      num_items: orderItems.reduce((s, x) => s + x.qty, 0),
    });
    if (!isQuickBuy) {
      // Only the items that were actually part of this order — anything
      // the customer left unchecked stays in the cart for a later order.
      cart = cart.filter((x) => x.selected === false);
      window.cart = cart;
      save();
      renderCart();
    }
  } catch (error) {
    closeCheckout();
    openOrderReadySheet(customer, orderItems);
  } finally {
    submit.disabled = false;
    submit.textContent = 'تأكيد الطلب';
  }
};
$('.whatsapp').onclick = () => openWhatsApp('السلام عليكم، نبي نستفسر عن منتجات Veronza Boutique.');
$$('[data-whatsapp-link]').forEach(
  (a) =>
    (a.onclick = (e) => {
      e.preventDefault();
      openWhatsApp('السلام عليكم، نبي نتواصل مع Veronza Boutique.');
    }),
);
$$('.footer-links a').forEach((a) => {
  if (a.textContent.includes('اتصل بنا'))
    a.onclick = (e) => {
      e.preventDefault();
      openWhatsApp('السلام عليكم، نبي نتواصل مع Veronza Boutique.');
    };
});
renderProducts();
renderCart();
updateWishlistCount();
loadProductsFromSupabase();
