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
const FLAT_SECTIONS = [
  { key: 'orders', label: 'الطلبات' },
  { key: 'chat', label: 'الرسائل' },
];
// One row per product category, kept in sync with product-categories.js —
// add a category there and a row for it appears here automatically.
const PRODUCT_CATEGORIES = window.VERONZA_PERMISSION_CATEGORIES || [];
// This page has no modal of its own, but the floating chat widget it loads
// needs somewhere to lock/unlock background scroll.
//
// overflow:hidden alone doesn't reliably block touch-driven scrolling on
// some mobile browsers - pin the body with position:fixed at its current
// scroll offset, which actually holds there too.
let vzScrollLockY = 0;
window.syncBodyScrollLock = function syncBodyScrollLock() {
  const anyOpen = !!document.querySelector('.vz-chatw-panel.open');
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
};
let restoredAfterUpdate = false;
function restoreAfterUpdate() {
  if (restoredAfterUpdate) return;
  restoredAfterUpdate = true;
  const state = window.veronzaConsumeRestoreState?.();
  if (!state) return;
  if (state.window === 'admin-chat-widget') waitAndRestoreChatWidget();
  if (typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
}
function waitAndRestoreChatWidget(tries = 20) {
  if (window.veronzaOpenAdminChatWidget) window.veronzaOpenAdminChatWidget();
  else if (tries > 0) setTimeout(() => waitAndRestoreChatWidget(tries - 1), 200);
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
  if (!r.ok || data.ok !== true) return { ok: false };
  return { ok: true, role: data.role, permissions: data.permissions || {} };
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

function permissionRowHtml(idPrefix, permKey, label, checkedView, checkedEdit) {
  return `<div class="permissions-row"><span class="section-name">${label}</span><label><input type="checkbox" data-perm="${permKey}" data-kind="view" id="${idPrefix}-${permKey}-view" ${checkedView ? 'checked' : ''}> عرض</label><label><input type="checkbox" data-perm="${permKey}" data-kind="edit" id="${idPrefix}-${permKey}-edit" ${checkedEdit ? 'checked' : ''}> تعديل</label></div>`;
}
function permissionsGridHtml(idPrefix, permissions = {}) {
  const flatRows = FLAT_SECTIONS.map((s) =>
    permissionRowHtml(idPrefix, s.key, s.label, permissions?.[s.key]?.view, permissions?.[s.key]?.edit),
  ).join('');
  const productRows = PRODUCT_CATEGORIES.map((c) =>
    permissionRowHtml(
      idPrefix,
      `products.${c.key}`,
      c.label,
      permissions?.products?.[c.key]?.view,
      permissions?.products?.[c.key]?.edit,
    ),
  ).join('');
  const productsBlock = productRows
    ? `<div class="permissions-group-title">المنتجات</div>${productRows}`
    : '';
  return flatRows + productsBlock;
}
function readPermissionsGrid(container) {
  const permissions = {};
  FLAT_SECTIONS.forEach((s) => {
    permissions[s.key] = {
      view: !!container.querySelector(`[data-perm="${s.key}"][data-kind="view"]`)?.checked,
      edit: !!container.querySelector(`[data-perm="${s.key}"][data-kind="edit"]`)?.checked,
    };
  });
  permissions.products = {};
  PRODUCT_CATEGORIES.forEach((c) => {
    const permKey = `products.${c.key}`;
    permissions.products[c.key] = {
      view: !!container.querySelector(`[data-perm="${permKey}"][data-kind="view"]`)?.checked,
      edit: !!container.querySelector(`[data-perm="${permKey}"][data-kind="edit"]`)?.checked,
    };
  });
  return permissions;
}
// Editing implies viewing — keep the two checkboxes in sync in the UI too.
function wireEditImpliesView(container) {
  container.querySelectorAll('[data-kind="edit"]').forEach((editBox) => {
    editBox.addEventListener('change', () => {
      if (editBox.checked) {
        const viewBox = container.querySelector(
          `[data-perm="${editBox.dataset.perm}"][data-kind="view"]`,
        );
        if (viewBox) viewBox.checked = true;
      }
    });
  });
}

function renderUserCard(u) {
  const isOwner = u.role === 'owner';
  const idPrefix = `u-${u.user_id}`;
  return `<div class="user-card" data-user-id="${esc(u.user_id)}"><div class="user-card-head"><div><span class="user-email">${esc(u.email || '')}</span> ${u.display_name ? `<span class="user-name">· ${esc(u.display_name)}</span>` : ''}</div><span class="${isOwner ? 'owner-badge' : 'staff-badge'}">${isOwner ? 'الحساب الرئيسي' : 'موظف'}</span></div>${
    isOwner
      ? '<p class="hint" style="margin:0">صلاحيات كاملة على جميع الأقسام — لا يمكن تعديلها.</p>'
      : `<div class="permissions-grid">${permissionsGridHtml(idPrefix, u.permissions)}</div><div class="user-card-actions"><button type="button" class="save-btn" data-save="${esc(u.user_id)}">حفظ الصلاحيات</button><button type="button" class="delete-btn" data-delete="${esc(u.user_id)}">حذف المستخدم</button></div>`
  }</div>`;
}

async function loadUsers() {
  try {
    const { users } = await api('/api/admin-users');
    $('#usersList').innerHTML = (users || []).map(renderUserCard).join('') ||
      '<p class="empty-state">لا يوجد مستخدمون.</p>';
    document.querySelectorAll('.user-card .permissions-grid').forEach(wireEditImpliesView);
  } catch (e) {
    $('#usersList').innerHTML = `<p class="empty-state">${esc(e.message)}</p>`;
  }
}

$('#usersList').addEventListener('click', async (e) => {
  const saveBtn = e.target.closest('[data-save]');
  const deleteBtn = e.target.closest('[data-delete]');
  if (saveBtn) {
    const card = saveBtn.closest('.user-card');
    const permissions = readPermissionsGrid(card);
    saveBtn.disabled = true;
    try {
      await api('/api/admin-users', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: saveBtn.dataset.save, permissions }),
      });
      toast('تم حفظ الصلاحيات ✓');
    } catch (err) {
      toast(err.message);
    }
    saveBtn.disabled = false;
  } else if (deleteBtn) {
    if (!confirm('هل تريد حذف هذا المستخدم؟ سيفقد القدرة على الدخول للوحة الإدارة فوراً.')) return;
    deleteBtn.disabled = true;
    try {
      await api('/api/admin-users?user_id=' + encodeURIComponent(deleteBtn.dataset.delete), {
        method: 'DELETE',
      });
      toast('تم حذف المستخدم ✓');
      loadUsers();
    } catch (err) {
      toast(err.message);
      deleteBtn.disabled = false;
    }
  }
});

$('#createPermissions').innerHTML = permissionsGridHtml('new', {});
wireEditImpliesView($('#createPermissions'));

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#createError').textContent = '';
  const email = $('#newEmail').value.trim();
  const password = $('#newPassword').value;
  const display_name = $('#newDisplayName').value.trim();
  const permissions = readPermissionsGrid($('#createPermissions'));
  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    await api('/api/admin-users', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name, permissions }),
    });
    toast('تم إنشاء المستخدم ✓');
    $('#createForm').reset();
    $('#createPermissions').innerHTML = permissionsGridHtml('new', {});
    wireEditImpliesView($('#createPermissions'));
    loadUsers();
  } catch (err) {
    $('#createError').textContent = err.message;
  }
  submitBtn.disabled = false;
});

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
    $('#loginError').textContent = 'أنت لا تملك صلاحيات الإدارة.';
    return;
  }
  showApp(data.session);
  applyOwnerGate(adminCheck);
});
$('#logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  showLogin();
};

function applyOwnerGate(adminCheck) {
  if (adminCheck.role === 'owner') {
    $('#notOwnerNotice').classList.add('hidden');
    $('#usersSection').classList.remove('hidden');
    loadUsers();
  } else {
    $('#notOwnerNotice').classList.remove('hidden');
    $('#usersSection').classList.add('hidden');
  }
  restoreAfterUpdate();
}

(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    showLogin();
    return;
  }
  const adminCheck = await checkAdmin(session.access_token);
  if (adminCheck.ok) {
    showApp(session);
    applyOwnerGate(adminCheck);
  } else {
    await sb.auth.signOut();
    showLogin();
  }
})();
