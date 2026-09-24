const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.veronzaSupabase = sb;
let orders = [],
  filter = 'all',
  selected = null,
  urlOrderHandled = false;
const $ = (s) => document.querySelector(s);
const statusNames = {
  pending: 'قيد المراجعة',
  confirmed: 'تم التأكيد',
  preparing: 'قيد التجهيز',
  shipped: 'جاري التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  returned: 'مرتجع',
};
function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}
function toast(t) {
  const x = $('#toast');
  x.textContent = t;
  x.classList.add('show');
  setTimeout(() => x.classList.remove('show'), 2600);
}
function showApp(session) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
}
function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}
async function checkAdmin(token) {
  const r = await fetch('/api/admin-auth', { headers: { Authorization: `Bearer ${token}` } });
  let data = {};
  try {
    data = await r.json();
  } catch (_) {}
  if (!r.ok || data.ok !== true) {
    return {
      ok: false,
      status: r.status,
      error: data.error || 'لا يوجد نص خطأ من السيرفر',
      debug: JSON.stringify(data),
    };
  }
  return { ok: true, role: data.role, permissions: data.permissions || {} };
}
let currentPermissions = { view: false, edit: false };
function applyOrdersPermissions(adminCheck) {
  currentPermissions = adminCheck.permissions?.orders || { view: false, edit: false };
  $('#usersMenuLink')?.toggleAttribute('hidden', adminCheck.role !== 'owner');
  $('#manualOrderBtn').hidden = !currentPermissions.edit;
  if (!currentPermissions.view) {
    $('main').innerHTML =
      '<p style="text-align:center;color:#888;padding:40px 16px">ماعندك صلاحية الوصول لقسم الطلبات.</p>';
  }
}
async function api(path, options = {}) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error('انتهت جلسة الدخول');
  const r = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = {};
  try {
    body = await r.json();
  } catch {}
  if (!r.ok) throw new Error(body.error || 'تعذر تنفيذ العملية');
  return body;
}
async function load() {
  try {
    const body = await api('/api/admin-orders');
    orders = body.orders || [];
    render();
    $('#lastUpdated').textContent =
      'آخر تحديث ' + new Date().toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
    maybeOpenFromUrl();
    restoreAfterUpdate();
  } catch (e) {
    toast(e.message);
  }
}
let restoredAfterUpdate = false;
function restoreAfterUpdate() {
  if (restoredAfterUpdate) return;
  restoredAfterUpdate = true;
  const state = window.veronzaConsumeRestoreState?.();
  if (!state) return;
  switch (state.window) {
    case 'admin-order':
      if (state.context?.orderId && orders.find((o) => o.id === state.context.orderId))
        openOrder(state.context.orderId);
      break;
    case 'admin-status':
      filter = state.context?.status || 'all';
      render();
      openStatusList(filter);
      break;
    case 'admin-manual-order':
      openManualOrderModal();
      break;
    case 'admin-chat-widget':
      waitAndRestoreChatWidget();
      break;
  }
  if (typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
}
function waitAndRestoreChatWidget(tries = 20) {
  if (window.veronzaOpenAdminChatWidget) window.veronzaOpenAdminChatWidget();
  else if (tries > 0) setTimeout(() => waitAndRestoreChatWidget(tries - 1), 200);
}
function maybeOpenFromUrl() {
  if (urlOrderHandled) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('order');
  if (id && orders.find((o) => o.id === id)) {
    urlOrderHandled = true;
    openOrder(id);
    return;
  }
  // Lets the admin-home dashboard's "+ إضافة طلب" quick action land
  // directly on this modal instead of just the plain orders list.
  if (params.get('new') === '1' && currentPermissions.edit) {
    urlOrderHandled = true;
    openManualOrderModal();
  }
}
function renderStats() {
  const c = (s) => orders.filter((o) => o.status === s).length;
  const items = [
    ['pending', 'جديدة', c('pending')],
    ['preparing', 'قيد التجهيز', c('preparing')],
    ['confirmed', 'تم التأكيد', c('confirmed')],
    ['shipped', 'جاري التوصيل', c('shipped')],
    ['delivered', 'تم التسليم', c('delivered')],
    ['cancelled', 'ملغي', c('cancelled')],
    ['returned', 'مرتجع', c('returned')],
    ['all', 'كل الطلبات', orders.length],
  ];
  $('#stats').innerHTML = items
    .map(
      ([status, label, count]) =>
        `<button type="button" class="stat${filter === status ? ' active' : ''}" data-status="${status}"><b>${count}</b><span>${label}</span></button>`,
    )
    .join('');
}
function orderRowHtml(o) {
  return `<div class="order-row" data-open="${o.id}"><div class="order-number">${esc(o.order_number)}</div><div class="customer"><b>${esc(o.customer_name)}</b><small>${esc(o.customer_phone)}</small></div><div class="amount">${Number(o.total || 0).toLocaleString('ar-LY')} د.ل</div><div><span class="status ${esc(o.status)}">${statusNames[o.status] || esc(o.status)}</span></div><div class="date">${new Date(o.created_at).toLocaleString('ar-LY')}</div><button class="details-btn" data-open="${o.id}">التفاصيل</button></div>`;
}
function render() {
  renderStats();
  document
    .querySelectorAll('.filters button')
    .forEach((x) => x.classList.toggle('active', x.dataset.status === filter));
  const list = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const box = $('#orders');
  if (!list.length) {
    box.innerHTML = '<div class="empty">لا توجد طلبات في هذا القسم حالياً.</div>';
    return;
  }
  box.innerHTML = list.map(orderRowHtml).join('');
}
function anyModalOpen() {
  return (
    !$('#orderModal').classList.contains('hidden') ||
    !$('#statusModal').classList.contains('hidden') ||
    !$('#manualOrderModal').classList.contains('hidden') ||
    !!document.querySelector('.vz-chatw-panel.open')
  );
}
// overflow:hidden alone doesn't reliably block touch-driven scrolling on
// some mobile browsers - pin the body with position:fixed at its current
// scroll offset, which actually holds there too.
let vzScrollLockY = 0;
function syncBodyScrollLock() {
  const anyOpen = anyModalOpen();
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

// Opening a modal never used to touch browser history, so the phone's own
// back gesture/button had nothing local to undo and fell straight through
// to whatever page was visited before this one (admin-home.html) - skipping
// right past the plain orders list a user expects one "back" to land on,
// with a visible flash as the browser restored that earlier page. Each
// modal open now pushes one history entry, and closing it (by any means -
// the × button, the backdrop, swipe-to-close, or the phone's own back
// gesture) consumes exactly that entry, so back only ever steps out one
// modal at a time and never leaves this page while one is open.
let vzModalHistoryDepth = 0;
let vzSuppressPopstate = false;
function pushModalHistoryState() {
  vzModalHistoryDepth++;
  history.pushState({ vzModal: true }, '', location.href);
}
function hideTopModalVisualOnly() {
  if (!$('#orderModal').classList.contains('hidden')) $('#orderModal').classList.add('hidden');
  else if (!$('#manualOrderModal').classList.contains('hidden'))
    $('#manualOrderModal').classList.add('hidden');
  else if (!$('#statusModal').classList.contains('hidden'))
    $('#statusModal').classList.add('hidden');
  syncBodyScrollLock();
}
function closeModalConsumingHistory(hideVisualFn) {
  hideVisualFn();
  syncBodyScrollLock();
  if (vzModalHistoryDepth > 0) {
    vzModalHistoryDepth--;
    vzSuppressPopstate = true;
    history.back();
  }
}
window.addEventListener('popstate', () => {
  if (vzSuppressPopstate) {
    vzSuppressPopstate = false;
    return;
  }
  if (vzModalHistoryDepth <= 0) return;
  vzModalHistoryDepth--;
  hideTopModalVisualOnly();
});
function openStatusList(status) {
  const label = status === 'all' ? 'جميع الطلبات' : statusNames[status] || status;
  const list = status === 'all' ? orders : orders.filter((o) => o.status === status);
  $('#statusModalTitle').textContent = `${label} (${list.length})`;
  $('#statusOrders').innerHTML = list.length
    ? list.map(orderRowHtml).join('')
    : '<div class="empty">لا توجد طلبات في هذا القسم حالياً.</div>';
  $('#statusModal').classList.remove('hidden');
  syncBodyScrollLock();
  pushModalHistoryState();
}
function closeStatusList() {
  closeModalConsumingHistory(() => $('#statusModal').classList.add('hidden'));
}
let editingOrderItems = false;
let orderItemsLoading = false;
let orderItemsError = '';
function orderItemsReadOnlyHtml() {
  if (orderItemsLoading) return '<div class="empty">جاري تحميل المنتجات...</div>';
  if (orderItemsError) return `<div class="empty">تعذر تحميل المنتجات. ${esc(orderItemsError)}</div>`;
  return (
    (selected.items || [])
      .map(
        (i) =>
          `<div class="item">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : '<div></div>'}<div><div class="item-name">${esc(i.product_name)}</div><div class="item-meta">الكود: ${esc(i.product_code)} · اللون: ${esc(i.color || '—')} · المقاس: ${esc(i.size || '—')} · الكمية: ${esc(i.quantity)}</div></div><div class="item-price">${Number(i.unit_price || 0).toLocaleString('ar-LY')} د.ل</div></div>`,
      )
      .join('') || '<div class="empty">لا توجد منتجات.</div>'
  );
}
function orderItemsEditorHtml() {
  return `<div class="manual-order-form"><div id="oeItems" class="manual-order-items"></div><button type="button" id="oeAddItem" class="ghost" style="align-self:flex-start">+ إضافة منتج</button><div class="manual-order-total">الإجمالي: <span id="oeTotal">0</span> د.ل</div><div id="oeError" class="error" role="alert"></div><div class="oe-actions"><button type="button" id="oeSave" class="primary">حفظ المنتجات</button><button type="button" id="oeCancel" class="ghost">إلغاء</button></div></div>`;
}
function renderOrderDetails() {
  const canEditItems = currentPermissions.edit && !orderItemsLoading && !orderItemsError;
  $('#orderDetails').innerHTML =
    `<div class="detail-title"><span class="eyebrow">VERONZA ORDER</span><h2>${esc(selected.order_number)}</h2><p>${new Date(selected.created_at).toLocaleString('ar-LY')} · WhatsApp: ${esc(selected.whatsapp_status || 'pending')}</p></div><div class="customer-box"><h3>بيانات الزبون</h3><div class="customer-grid"><div class="field field-wide"><b>الاسم</b><span>${esc(selected.customer_name)}</span><b>الهاتف</b><span>${esc(selected.customer_phone)}</span></div><div class="field field-wide"><b>العنوان</b><span>${esc(selected.customer_address)}</span></div></div><div class="contact-actions"><a href="tel:${esc(selected.customer_phone)}">اتصال بالزبون</a><a target="_blank" rel="noopener noreferrer" href="https://wa.me/${encodeURIComponent(selected.customer_phone.replace(/\D/g, ''))}">WhatsApp</a></div></div><div class="items-box"><h3><span>المنتجات</span>${
      canEditItems && !editingOrderItems
        ? '<button type="button" class="edit-items-toggle" id="editItemsBtn">تعديل المنتجات</button>'
        : ''
    }</h3>${editingOrderItems ? orderItemsEditorHtml() : orderItemsReadOnlyHtml()}<div style="display:flex;justify-content:space-between;margin-top:12px;font-weight:800"><span>الإجمالي</span><span>${Number(selected.total || 0).toLocaleString('ar-LY')} د.ل</span></div></div><div class="actions-box"><h3>إدارة الطلب</h3><div class="detail-actions"><select id="orderStatus">${Object.entries(
      statusNames,
    )
      .map(
        ([k, v]) => `<option value="${k}" ${selected.status === k ? 'selected' : ''}>${v}</option>`,
      )
      .join(
        '',
      )}</select><div></div><textarea id="adminNote" placeholder="ملاحظات الأدمن">${esc(selected.admin_notes || '')}</textarea><button class="save-status" id="saveOrder">حفظ حالة الطلب</button>${currentPermissions.edit ? '' : '<p style="color:#888;font-size:13px">ماعندك صلاحية تعديل الطلبات — للعرض فقط.</p>'}</div></div>`;
  $('#orderStatus').disabled = !currentPermissions.edit;
  $('#adminNote').disabled = !currentPermissions.edit;
  $('#saveOrder').hidden = !currentPermissions.edit;
  $('#saveOrder').onclick = saveOrder;
  if (editingOrderItems) {
    loadManualOrderProducts().then(() => {
      const items = selected.items && selected.items.length ? selected.items : [null];
      items.forEach((i) => oeAddItemRow(i));
      oeUpdateTotal();
    });
    $('#oeAddItem').onclick = () => oeAddItemRow();
    $('#oeCancel').onclick = () => {
      editingOrderItems = false;
      renderOrderDetails();
    };
    $('#oeSave').onclick = saveOrderItems;
  } else if (canEditItems) {
    $('#editItemsBtn').onclick = () => {
      editingOrderItems = true;
      renderOrderDetails();
    };
  }
}
function openOrder(id) {
  selected = orders.find((o) => o.id === id);
  if (!selected) return;
  selected.items = selected.items || [];
  editingOrderItems = false;
  orderItemsLoading = true;
  orderItemsError = '';
  renderOrderDetails();
  $('#orderModal').classList.remove('hidden');
  syncBodyScrollLock();
  pushModalHistoryState();
  api('/api/admin-orders?order_id=' + encodeURIComponent(id))
    .then((body) => {
      selected.items = body.items || [];
      orderItemsLoading = false;
      if ($('#orderModal').classList.contains('hidden')) return;
      renderOrderDetails();
    })
    .catch((e) => {
      orderItemsLoading = false;
      orderItemsError = e.message;
      if ($('#orderModal').classList.contains('hidden')) return;
      renderOrderDetails();
    });
}
function oeItemRowHtml(products) {
  const options = products
    .map((p) => `<option value="${p.code}">${esc(p.name)} — ${esc(p.code)}</option>`)
    .join('');
  return `<div class="manual-order-item"><div class="item-grid"><label>المنتج<select data-oe-product><option value="">اختار منتج</option>${options}</select></label><label>اللون<select data-oe-color></select></label><label>المقاس<select data-oe-size></select></label><label>الكمية<input data-oe-qty type="number" min="1" step="1" value="1"></label></div><button type="button" class="remove-item" data-oe-remove>حذف</button></div>`;
}
function oeUpdateItemRow(row, products) {
  const productSelect = row.querySelector('[data-oe-product]');
  const colorSelect = row.querySelector('[data-oe-color]');
  const sizeSelect = row.querySelector('[data-oe-size]');
  const p = products.find((x) => x.code === productSelect.value);
  if (!p) {
    colorSelect.innerHTML = '';
    sizeSelect.innerHTML = '';
    colorSelect.disabled = true;
    sizeSelect.disabled = true;
    oeUpdateTotal();
    return;
  }
  colorSelect.disabled = false;
  colorSelect.innerHTML =
    (p.colors || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('') ||
    '<option value="">موحد</option>';
  const desiredColor = row.dataset.oeInitialColor;
  if (desiredColor && [...colorSelect.options].some((o) => o.value === desiredColor))
    colorSelect.value = desiredColor;
  if (moIsSizeRequired(p)) {
    sizeSelect.disabled = false;
    sizeSelect.innerHTML =
      '<option value="">اختار المقاس</option>' +
      (p.sizes || [])
        .map((s) => {
          const out = moSizeStock(p, s) <= 0;
          return `<option value="${esc(s)}" ${out ? 'disabled' : ''}>${esc(s)}${out ? ' (نفذت)' : ''}</option>`;
        })
        .join('');
    const desiredSize = row.dataset.oeInitialSize;
    if (desiredSize && [...sizeSelect.options].some((o) => o.value === desiredSize))
      sizeSelect.value = desiredSize;
  } else {
    sizeSelect.disabled = true;
    sizeSelect.innerHTML = '<option value="">—</option>';
  }
  oeUpdateTotal();
}
function oeUpdateTotal() {
  let total = 0;
  $('#oeItems')
    .querySelectorAll('.manual-order-item')
    .forEach((row) => {
      const code = row.querySelector('[data-oe-product]').value;
      const qty = Math.max(1, Number(row.querySelector('[data-oe-qty]').value) || 1);
      const p = manualOrderProducts?.find((x) => x.code === code);
      if (p) total += moEffectivePrice(p) * qty;
    });
  const totalEl = $('#oeTotal');
  if (totalEl) totalEl.textContent = total.toLocaleString('ar-LY');
}
function oeAddItemRow(initial) {
  const products = manualOrderProducts || [];
  const wrap = document.createElement('div');
  wrap.innerHTML = oeItemRowHtml(products);
  const row = wrap.firstElementChild;
  if (initial) {
    row.dataset.oeInitialColor = initial.color || '';
    row.dataset.oeInitialSize = initial.size || '';
  }
  $('#oeItems').appendChild(row);
  const productSelect = row.querySelector('[data-oe-product]');
  if (initial?.product_code) productSelect.value = initial.product_code;
  productSelect.addEventListener('change', () => oeUpdateItemRow(row, products));
  row.querySelector('[data-oe-qty]').addEventListener('input', oeUpdateTotal);
  row.querySelector('[data-oe-remove]').addEventListener('click', () => {
    row.remove();
    oeUpdateTotal();
  });
  if (initial?.quantity) row.querySelector('[data-oe-qty]').value = initial.quantity;
  oeUpdateItemRow(row, products);
}
async function saveOrderItems() {
  $('#oeError').textContent = '';
  const items = [];
  let invalid = false;
  $('#oeItems')
    .querySelectorAll('.manual-order-item')
    .forEach((row) => {
      const code = row.querySelector('[data-oe-product]').value;
      const color = row.querySelector('[data-oe-color]').value || null;
      const size = row.querySelector('[data-oe-size]').value || null;
      const qty = Math.max(1, Number(row.querySelector('[data-oe-qty]').value) || 1);
      const p = manualOrderProducts?.find((x) => x.code === code);
      if (!code || !p) {
        invalid = true;
        return;
      }
      if (moIsSizeRequired(p) && !size) {
        invalid = true;
        return;
      }
      items.push({ product_code: code, color, size, quantity: qty });
    });
  if (invalid || !items.length) {
    $('#oeError').textContent = 'حدد منتج ومقاس صحيح لكل عنصر في الطلب.';
    return;
  }
  const saveBtn = $('#oeSave');
  saveBtn.disabled = true;
  let body;
  try {
    body = await api('/api/admin-orders', {
      method: 'PATCH',
      body: JSON.stringify({ id: selected.id, items }),
    });
  } catch (e) {
    saveBtn.disabled = false;
    $('#oeError').textContent = e.message;
    return;
  }
  selected = { ...selected, ...body.order };
  const idx = orders.findIndex((o) => o.id === selected.id);
  if (idx >= 0) orders[idx] = selected;
  editingOrderItems = false;
  orderItemsLoading = true;
  orderItemsError = '';
  renderOrderDetails();
  render();
  toast('تم حفظ المنتجات ✓');
  try {
    const itemsBody = await api('/api/admin-orders?order_id=' + encodeURIComponent(selected.id));
    selected.items = itemsBody.items || [];
    orderItemsLoading = false;
  } catch (e) {
    orderItemsLoading = false;
    orderItemsError = e.message;
  }
  if (!$('#orderModal').classList.contains('hidden')) renderOrderDetails();
}
async function saveOrder() {
  try {
    const status = $('#orderStatus').value;
    const admin_notes = $('#adminNote').value;
    const body = await api('/api/admin-orders', {
      method: 'PATCH',
      body: JSON.stringify({ id: selected.id, status, admin_notes }),
    });
    selected = { ...selected, ...body.order };
    const idx = orders.findIndex((o) => o.id === selected.id);
    if (idx >= 0) orders[idx] = selected;
    render();
    closeOrderModal();
    if (body.notify) {
      toast(
        body.notify.sent
          ? 'تم حفظ الطلب وإشعار الزبون عبر واتساب ✓'
          : 'تم حفظ الطلب، لكن إشعار الزبون بواتساب فشل',
      );
    } else {
      toast('تم حفظ الطلب');
    }
  } catch (e) {
    toast(e.message);
  }
}
function enableSwipeToClose(modalSelector, closeFn) {
  const modal = $(modalSelector);
  const card = modal.querySelector('.modal-card');
  const head = modal.querySelector('.sheet-head');
  // A small deadzone before the card starts moving, and skipping the close
  // button entirely - otherwise the natural few px of finger movement
  // during an ordinary tap on the × immediately starts "dragging" the
  // card, which on real touchscreens can suppress the click that would
  // normally fire on release, making the close button feel unresponsive.
  const deadzone = 8;
  let startY = 0,
    dragging = false;
  head.addEventListener(
    'touchstart',
    (e) => {
      if (e.target.closest('.close')) return;
      startY = e.touches[0].clientY;
      dragging = true;
      card.style.transition = 'none';
    },
    { passive: true },
  );
  head.addEventListener(
    'touchmove',
    (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= deadzone) return;
      card.style.transform = `translateY(${dy - deadzone}px)`;
    },
    { passive: true },
  );
  head.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    card.style.transition = 'transform .2s ease';
    if (dy > 90) {
      card.style.transform = `translateY(${window.innerHeight}px)`;
      setTimeout(() => {
        closeFn();
        card.style.transition = 'none';
        card.style.transform = '';
      }, 180);
    } else {
      card.style.transform = '';
    }
  });
  head.addEventListener('touchcancel', () => {
    dragging = false;
    card.style.transition = 'transform .2s ease';
    card.style.transform = '';
  });
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(),
    password: $('#password').value,
  });
  if (error) {
    $('#loginError').textContent = error.message;
    return;
  }
  const adminCheck = await checkAdmin(data.session.access_token);
  if (!adminCheck.ok) {
    await sb.auth.signOut();
    $('#loginError').textContent = `[تشخيص] ${adminCheck.debug}`;
    return;
  }
  showApp(data.session);
  applyOrdersPermissions(adminCheck);
  load();
});
$('#logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  showLogin();
};
$('#refreshBtn').onclick = load;
$('#copySiteLinkBtn').onclick = async () => {
  const link = `${location.origin}/`;
  try {
    await navigator.clipboard.writeText(link);
    toast('تم نسخ رابط الموقع ✓');
  } catch (_) {
    prompt('انسخ رابط الموقع:', link);
  }
};
$('.filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  filter = b.dataset.status;
  render();
  openStatusList(filter);
});
$('#stats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  filter = b.dataset.status;
  render();
  openStatusList(filter);
});
$('#statusOrders').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open]');
  if (row) openOrder(row.dataset.open);
});
$('#closeStatusModal').onclick = closeStatusList;
$('#statusModal').addEventListener('click', (e) => {
  if (e.target.id === 'statusModal') closeStatusList();
});
$('#orders').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open]');
  if (row) openOrder(row.dataset.open);
});
const closeOrderModal = () => {
  closeModalConsumingHistory(() => $('#orderModal').classList.add('hidden'));
};
$('#closeModal').onclick = closeOrderModal;
$('#orderModal').addEventListener('click', (e) => {
  if (e.target.id === 'orderModal') closeOrderModal();
});
enableSwipeToClose('#orderModal', closeOrderModal);
enableSwipeToClose('#statusModal', closeStatusList);

let manualOrderProducts = null;
async function loadManualOrderProducts() {
  if (manualOrderProducts) return manualOrderProducts;
  const { data, error } = await sb
    .from('products')
    .select('id,code,name,price,discount_price,type,colors,sizes,size_quantities,quantity')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) {
    manualOrderProducts = [];
    return manualOrderProducts;
  }
  manualOrderProducts = data || [];
  return manualOrderProducts;
}
function moEffectivePrice(p) {
  return p.discount_price != null && Number(p.discount_price) < Number(p.price)
    ? Number(p.discount_price)
    : Number(p.price);
}
function moIsSizeRequired(p) {
  return p?.type === 'shoes' || p?.type === 'set';
}
function moSizeStock(p, size) {
  if (!moIsSizeRequired(p)) return Number(p?.quantity || 0);
  const sq = p?.size_quantities;
  if (sq && Object.prototype.hasOwnProperty.call(sq, size)) return Number(sq[size] || 0);
  return Number(p?.quantity || 0);
}
function moItemRowHtml(products) {
  const options = products
    .map((p) => `<option value="${p.code}">${esc(p.name)} — ${esc(p.code)}</option>`)
    .join('');
  return `<div class="manual-order-item"><div class="item-grid"><label>المنتج<select data-mo-product><option value="">اختار منتج</option>${options}</select></label><label>اللون<select data-mo-color></select></label><label>المقاس<select data-mo-size></select></label><label>الكمية<input data-mo-qty type="number" min="1" step="1" value="1"></label></div><button type="button" class="remove-item" data-mo-remove>حذف</button></div>`;
}
function moUpdateItemRow(row, products) {
  const productSelect = row.querySelector('[data-mo-product]');
  const colorSelect = row.querySelector('[data-mo-color]');
  const sizeSelect = row.querySelector('[data-mo-size]');
  const p = products.find((x) => x.code === productSelect.value);
  if (!p) {
    colorSelect.innerHTML = '';
    sizeSelect.innerHTML = '';
    colorSelect.disabled = true;
    sizeSelect.disabled = true;
    return;
  }
  colorSelect.disabled = false;
  colorSelect.innerHTML = (p.colors || [])
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('') || '<option value="">موحد</option>';
  if (moIsSizeRequired(p)) {
    sizeSelect.disabled = false;
    sizeSelect.innerHTML =
      '<option value="">اختار المقاس</option>' +
      (p.sizes || [])
        .map((s) => {
          const out = moSizeStock(p, s) <= 0;
          return `<option value="${esc(s)}" ${out ? 'disabled' : ''}>${esc(s)}${out ? ' (نفذت)' : ''}</option>`;
        })
        .join('');
  } else {
    sizeSelect.disabled = true;
    sizeSelect.innerHTML = '<option value="">—</option>';
  }
  moUpdateTotal();
}
function moUpdateTotal() {
  let total = 0;
  $('#moItems')
    .querySelectorAll('.manual-order-item')
    .forEach((row) => {
      const code = row.querySelector('[data-mo-product]').value;
      const qty = Math.max(1, Number(row.querySelector('[data-mo-qty]').value) || 1);
      const p = manualOrderProducts?.find((x) => x.code === code);
      if (p) total += moEffectivePrice(p) * qty;
    });
  $('#moTotal').textContent = total.toLocaleString('ar-LY');
}
function moAddItemRow() {
  const products = manualOrderProducts || [];
  const wrap = document.createElement('div');
  wrap.innerHTML = moItemRowHtml(products);
  const row = wrap.firstElementChild;
  $('#moItems').appendChild(row);
  row.querySelector('[data-mo-product]').addEventListener('change', () => moUpdateItemRow(row, products));
  row.querySelector('[data-mo-qty]').addEventListener('input', moUpdateTotal);
  row.querySelector('[data-mo-remove]').addEventListener('click', () => {
    row.remove();
    moUpdateTotal();
  });
  moUpdateItemRow(row, products);
}
async function openManualOrderModal() {
  $('#moError').textContent = '';
  $('#manualOrderForm').reset();
  $('#moItems').innerHTML = '';
  await loadManualOrderProducts();
  moAddItemRow();
  moUpdateTotal();
  $('#manualOrderModal').classList.remove('hidden');
  syncBodyScrollLock();
  pushModalHistoryState();
}
function closeManualOrderModal() {
  closeModalConsumingHistory(() => $('#manualOrderModal').classList.add('hidden'));
}
$('#manualOrderBtn').onclick = openManualOrderModal;
$('#closeManualOrderModal').onclick = closeManualOrderModal;
$('#manualOrderModal').addEventListener('click', (e) => {
  if (e.target.id === 'manualOrderModal') closeManualOrderModal();
});
$('#moAddItem').onclick = moAddItemRow;
enableSwipeToClose('#manualOrderModal', closeManualOrderModal);

$('#manualOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#moError').textContent = '';
  const items = [];
  let invalid = false;
  $('#moItems')
    .querySelectorAll('.manual-order-item')
    .forEach((row) => {
      const code = row.querySelector('[data-mo-product]').value;
      const color = row.querySelector('[data-mo-color]').value || null;
      const size = row.querySelector('[data-mo-size]').value || null;
      const qty = Math.max(1, Number(row.querySelector('[data-mo-qty]').value) || 1);
      const p = manualOrderProducts?.find((x) => x.code === code);
      if (!code || !p) {
        invalid = true;
        return;
      }
      if (moIsSizeRequired(p) && !size) {
        invalid = true;
        return;
      }
      items.push({ product_code: code, color, size, quantity: qty });
    });
  if (invalid || !items.length) {
    $('#moError').textContent = 'حدد منتج ومقاس صحيح لكل عنصر في الطلب.';
    return;
  }
  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const result = await api('/api/admin-orders', {
      method: 'POST',
      body: JSON.stringify({
        customer_name: $('#moCustomerName').value.trim(),
        customer_phone: $('#moCustomerPhone').value.trim(),
        customer_address: $('#moCustomerAddress').value.trim(),
        items,
      }),
    });
    toast(`تم إنشاء الطلب ${result.order_number} ✓`);
    closeManualOrderModal();
    load();
  } catch (err) {
    $('#moError').textContent = err.message;
  }
  submitBtn.disabled = false;
});

(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    showLogin();
    return;
  }
  try {
    const adminCheck = await checkAdmin(session.access_token);
    if (adminCheck.ok) {
      showApp(session);
      applyOrdersPermissions(adminCheck);
      load();
    } else if (adminCheck.status === 401 || adminCheck.status === 403) {
      await sb.auth.signOut();
      showLogin();
    } else {
      showApp(session);
      load();
    }
  } catch (e) {
    showApp(session);
    load();
  }
})();
setInterval(() => {
  if (!$('#appView').classList.contains('hidden')) load();
}, 30000);
