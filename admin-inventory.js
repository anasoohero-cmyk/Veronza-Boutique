const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.veronzaSupabase = sb;
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
const typeNames = { shoes: 'السبيدروات', bags: 'الشنط', set: 'السيتات' };

// A total this low or below is "منخفض" (running low); at 0 it's "نفذ"
// (out). Sized products (shoes/sets) are judged per size too, since a
// product can look fine overall while a specific size is nearly gone.
const LOW_STOCK_THRESHOLD = 5;
const LOW_SIZE_THRESHOLD = 2;

function toast(t) {
  const x = $('#toast');
  x.textContent = t;
  x.classList.add('show');
  setTimeout(() => x.classList.remove('show'), 2600);
}
let vzScrollLockY = 0;
function syncBodyScrollLock() {
  const anyOpen = !!document.querySelector('.vz-chatw-panel.open,.vz-panel.open');
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

async function checkAdmin(token) {
  try {
    const r = await fetch('/api/admin-auth', { headers: { Authorization: `Bearer ${token}` } });
    let data = {};
    try {
      data = await r.json();
    } catch (_) {}
    return { ok: r.ok && data.ok === true, status: r.status, role: data.role, permissions: data.permissions || {} };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

// Same category-permission model as admin-products.js: an admin can view a
// category's products without being able to edit them, and the owner
// bypasses this entirely, matching the database's own RLS checks.
let isOwner = false;
let viewableCategories = {};
function canViewType(type) {
  return isOwner || !!viewableCategories[type]?.view;
}

let products = [];
let activeFilter = 'all';

function showApp(session, adminCheck) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
  if (adminCheck) applyPermissions(adminCheck);
}
function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

function applyPermissions(adminCheck) {
  isOwner = adminCheck.role === 'owner';
  viewableCategories = adminCheck.permissions?.products || {};
  $('#usersMenuLink')?.toggleAttribute('hidden', adminCheck.role !== 'owner');
  const canViewAny = Object.keys(typeNames).some(canViewType);
  $('#inventoryApp').classList.toggle('hidden', !canViewAny);
  $('#noPermissionNotice').classList.toggle('hidden', canViewAny);
  if (canViewAny) load();
}

function sizeStatus(qty) {
  const q = Number(qty || 0);
  if (q <= 0) return 'out';
  if (q <= LOW_SIZE_THRESHOLD) return 'low';
  return 'ok';
}
function productStatus(p) {
  const q = Number(p.quantity || 0);
  if (q <= 0) return 'out';
  const isSized = p.type === 'shoes' || p.type === 'set';
  if (isSized) {
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    const sq = p.size_quantities || {};
    if (sizes.some((s) => sizeStatus(sq[s]) === 'low' || sizeStatus(sq[s]) === 'out')) return 'low';
  }
  if (q <= LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}
const STATUS_LABEL = { ok: 'متوفر', low: 'منخفض', out: 'نفذ' };

// A shoe and a set under the same model_code share one physical stock (the
// sync trigger keeps their quantity/size_quantities identical) - counting
// both toward the totals below would double the real stock. A shoe can also
// be shared across several sets with their own distinct model_codes via
// shoe_set_links, so model_code equality alone isn't enough - group codes
// that shoe_set_links ties together (mirrors the DB's model_sync_group()).
// Bags (and any product with no model_code) always count on their own.
let syncGroupRoot = new Map();
let syncGroupMembers = new Map();
function buildSyncGroups(shoeLinkRows) {
  const parent = new Map();
  const find = (x) => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  shoeLinkRows.forEach((l) => {
    if (l.shoe_model_code && l.set_model_code) union(l.shoe_model_code, l.set_model_code);
  });
  const root = new Map();
  parent.forEach((_, code) => root.set(code, find(code)));
  return root;
}
function groupCode(p) {
  return syncGroupRoot.get(p.model_code) || p.model_code;
}
// Model codes tied together via shoe_set_links (e.g. one shoe shared by
// sets V17/V18/V19) - shown so a linked product's card doesn't just list
// its own model code while hiding the other models it actually shares
// stock with.
function linkedModelCodes(p) {
  if (!p.model_code || !syncGroupRoot.has(p.model_code)) return [];
  const members = syncGroupMembers.get(groupCode(p)) || new Set();
  return [...members].filter((c) => c !== p.model_code).sort();
}
function stockUnits() {
  const seenModels = new Set();
  return products.filter((p) => {
    if ((p.type !== 'shoes' && p.type !== 'set') || !p.model_code) return true;
    const g = groupCode(p);
    if (seenModels.has(g)) return false;
    seenModels.add(g);
    return true;
  });
}

async function load() {
  const { data, error } = await sb
    .from('products')
    .select('id,code,name,type,model_code,img,quantity,sizes,size_quantities,is_active')
    .order('quantity', { ascending: true });
  if (error) {
    toast('تعذر تحميل بيانات المخزون: ' + error.message);
    return;
  }
  products = (data || []).filter((p) => canViewType(p.type));
  const { data: linkRows } = await sb.from('shoe_set_links').select('shoe_product_id, set_model_code');
  const shoeModelById = new Map(products.map((p) => [String(p.id), p.model_code]));
  const shoeLinkRows = (linkRows || []).map((l) => ({
    set_model_code: l.set_model_code,
    shoe_model_code: shoeModelById.get(String(l.shoe_product_id)),
  }));
  syncGroupRoot = buildSyncGroups(shoeLinkRows);
  syncGroupMembers = new Map();
  syncGroupRoot.forEach((root, code) => {
    if (!syncGroupMembers.has(root)) syncGroupMembers.set(root, new Set());
    syncGroupMembers.get(root).add(code);
  });
  render();
  $('#inventoryLastUpdated').textContent =
    'آخر تحديث ' + new Date().toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
}

function renderStats() {
  const units = stockUnits();
  const totalStock = units.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const outCount = units.filter((p) => productStatus(p) === 'out').length;
  const lowCount = units.filter((p) => productStatus(p) === 'low').length;
  $('#inventoryStats').innerHTML = `
    <button class="stat" type="button" data-stat="all"><b>${totalStock}</b><span>إجمالي المخزون (قطعة)</span></button>
    <button class="stat" type="button" data-stat="all"><b>${products.length}</b><span>عدد المنتجات</span></button>
    <button class="stat" type="button" data-stat="low"><b>${lowCount}</b><span>منخفضة المخزون</span></button>
    <button class="stat" type="button" data-stat="out"><b>${outCount}</b><span>نفذت من المخزون</span></button>
  `;
  $('#inventoryStats')
    .querySelectorAll('[data-stat]')
    .forEach((b) => (b.onclick = () => setFilter(b.dataset.stat)));
}

function setFilter(filter) {
  activeFilter = filter;
  $('#inventoryFilters')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
  renderList();
}

function renderList() {
  const list = products.filter((p) => activeFilter === 'all' || productStatus(p) === activeFilter);
  const box = $('#inventoryList');
  if (!list.length) {
    box.innerHTML = '<div class="empty">ما فيه منتجات هنا حالياً.</div>';
    return;
  }
  box.innerHTML = list
    .map((p) => {
      const status = productStatus(p);
      const isSized = p.type === 'shoes' || p.type === 'set';
      const sizes = Array.isArray(p.sizes) ? p.sizes : [];
      const sq = p.size_quantities || {};
      const sizesHtml = isSized
        ? `<div class="inv-sizes">${sizes
            .map((s) => `<span class="size-chip ${sizeStatus(sq[s])}">${esc(s)} · ${Number(sq[s] || 0)}</span>`)
            .join('')}</div>`
        : '';
      const linked = linkedModelCodes(p);
      const modelHtml = p.model_code
        ? ` · الموديل: ${esc(p.model_code)}${linked.length ? ` (مرتبط مع ${linked.map(esc).join('، ')})` : ''}`
        : '';
      return `<div class="inv-row"><img class="thumb" src="${esc(p.img)}" alt=""><div class="inv-main"><h3>${esc(p.name)}</h3><div class="meta">الكود: ${esc(p.code)}${modelHtml} · النوع: ${typeNames[p.type] || esc(p.type)}${p.is_active ? '' : ' · غير مفعّل'}</div>${sizesHtml}</div><div class="inv-total"><b>${Number(p.quantity || 0)}</b><span>قطعة</span></div><span class="badge ${status}">${STATUS_LABEL[status]}</span></div>`;
    })
    .join('');
}

function render() {
  renderStats();
  renderList();
}

$('#inventoryFilters')
  .querySelectorAll('button')
  .forEach((b) => (b.onclick = () => setFilter(b.dataset.filter)));

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
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  const check = await checkAdmin(session.access_token);
  if (check.ok) showApp(session, check);
  else {
    await sb.auth.signOut();
    $('#loginError').textContent = 'أنت لا تملك صلاحيات الإدارة.';
  }
});

(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    $('#loginView').classList.remove('hidden');
    return;
  }
  const check = await checkAdmin(session.access_token);
  if (check.ok) showApp(session, check);
  else if (check.status === 401 || check.status === 403) {
    await sb.auth.signOut();
    $('#loginView').classList.remove('hidden');
  } else showApp(session);
})();

$('#logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  showLogin();
};
$('#refreshBtn').onclick = load;
