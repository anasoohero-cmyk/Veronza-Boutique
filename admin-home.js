const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.veronzaSupabase = sb;
const $ = (s) => document.querySelector(s);

// Same low-stock thresholds as admin-inventory.js, kept in sync by hand
// since these pages don't share a module — a total this low or below is
// "منخفض" (running low); at 0 it's "نفذ" (out). Sized products (shoes/
// sets) are also judged per size.
const LOW_STOCK_THRESHOLD = 5;
const LOW_SIZE_THRESHOLD = 2;

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

function showApp(session, adminCheck) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
  if (adminCheck) buildDashboard(session, adminCheck);
}
function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

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
    if (sizes.some((s) => sizeStatus(sq[s]) !== 'ok')) return 'low';
  }
  if (q <= LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

function cardHtml({ href, icon, title, detail, tone }) {
  return `<a class="home-card${tone ? ' ' + tone : ''}" href="${href}"><span class="home-card-icon">${icon}</span><span class="home-card-body"><strong>${title}</strong><span class="home-card-detail">${detail}</span></span><span class="home-card-arrow">←</span></a>`;
}

const ICONS = {
  orders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
  products:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  inventory:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};

async function buildDashboard(session, adminCheck) {
  const isOwner = adminCheck.role === 'owner';
  const perms = adminCheck.permissions || {};
  $('#usersMenuLink')?.toggleAttribute('hidden', !isOwner);

  const canViewOrders = isOwner || !!perms.orders?.view;
  const canEditOrders = isOwner || !!perms.orders?.edit;
  const canViewChat = isOwner || !!perms.chat?.view;
  const productCats = perms.products || {};
  const canViewAnyProducts = isOwner || Object.values(productCats).some((c) => c?.view);

  $('#quickAddOrderBtn').classList.toggle('hidden', !canEditOrders);

  const cards = [];

  if (canViewOrders) {
    let detail = 'اضغط لعرض كل الطلبات';
    let tone = '';
    try {
      const r = await fetch('/api/admin-orders', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await r.json();
      if (r.ok && Array.isArray(body.orders)) {
        const pending = body.orders.filter((o) => o.status === 'pending').length;
        detail = pending > 0 ? `${pending} طلب جديد · ${body.orders.length} إجمالي` : `${body.orders.length} طلب إجمالي`;
        tone = pending > 0 ? 'alert' : '';
      }
    } catch (_) {}
    cards.push(cardHtml({ href: '/admin.html', icon: ICONS.orders, title: 'الطلبات', detail, tone }));
  }

  if (canViewAnyProducts) {
    let products = [];
    try {
      const { data } = await sb
        .from('products')
        .select('id,quantity,type,is_active,sizes,size_quantities');
      products = data || [];
    } catch (_) {}
    const activeCount = products.filter((p) => p.is_active).length;
    cards.push(
      cardHtml({
        href: '/admin-products.html',
        icon: ICONS.products,
        title: 'المنتجات',
        detail: `${products.length} منتج · ${activeCount} مفعّل`,
      }),
    );
    const lowCount = products.filter((p) => productStatus(p) === 'low').length;
    const outCount = products.filter((p) => productStatus(p) === 'out').length;
    cards.push(
      cardHtml({
        href: '/admin-inventory.html',
        icon: ICONS.inventory,
        title: 'المخزون',
        detail: lowCount || outCount ? `${lowCount} منخفض · ${outCount} نفذ` : 'المخزون بحالة جيدة',
        tone: outCount > 0 ? 'alert' : lowCount > 0 ? 'warn' : '',
      }),
    );
  }

  if (canViewChat) {
    let detail = 'اضغط لعرض المحادثات';
    let tone = '';
    try {
      const { data } = await sb
        .from('chat_conversations')
        .select('id')
        .eq('admin_unread', true);
      const unread = (data || []).length;
      detail = unread > 0 ? `${unread} محادثة غير مقروءة` : 'ما فيه رسائل جديدة';
      tone = unread > 0 ? 'alert' : '';
    } catch (_) {}
    cards.push(cardHtml({ href: '/admin-chat.html', icon: ICONS.chat, title: 'الرسائل', detail, tone }));
  }

  if (isOwner) {
    cards.push(
      cardHtml({
        href: '/admin-users.html',
        icon: ICONS.users,
        title: 'المستخدمون والصلاحيات',
        detail: 'إدارة حسابات الموظفين وصلاحياتهم',
      }),
    );
  }

  $('#homeGrid').innerHTML = cards.join('') || '<div class="empty">ماعندك صلاحية الوصول لأي قسم بعد.</div>';
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
$('#refreshBtn').onclick = () => location.reload();
