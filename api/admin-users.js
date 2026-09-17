const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FLAT_SECTIONS = ['orders', 'chat'];
const CATEGORY_KEY_RE = /^[a-z0-9_]{1,40}$/;

function allowedOrigin(req) {
  const o = req.headers.origin;
  if (!o) return '';
  try {
    return new URL(o).host === req.headers.host ? o : '';
  } catch {
    return '';
  }
}
function corsHeaders(req) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    Vary: 'Origin',
  };
  const origin = allowedOrigin(req);
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(req, res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.end(JSON.stringify(body));
}
async function sbFetch(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data };
}
function normalizePermissions(raw) {
  const out = {};
  for (const section of FLAT_SECTIONS) {
    out[section] = {
      view: !!raw?.[section]?.view,
      edit: !!raw?.[section]?.edit,
    };
    // Edit implies view — an editor who can't see the section is a dead end.
    if (out[section].edit) out[section].view = true;
  }
  // Product categories are open-ended (a new one can be added to
  // product-categories.js later without any server change), so accept
  // whatever category keys the client sends instead of hardcoding a list —
  // just validate their shape before it lands in the JSON column.
  out.products = {};
  const rawProducts = raw?.products && typeof raw.products === 'object' ? raw.products : {};
  for (const [key, val] of Object.entries(rawProducts)) {
    if (!CATEGORY_KEY_RE.test(key)) continue;
    const view = !!val?.view;
    const edit = !!val?.edit;
    out.products[key] = { view: view || edit, edit };
  }
  return out;
}
async function requireOwner(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const u = await sbFetch('/auth/v1/user', {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
  });
  if (!u.ok || !u.data?.id) return null;
  const a = await sbFetch(
    `/rest/v1/admin_users?select=user_id,role&user_id=eq.${encodeURIComponent(u.data.id)}&limit=1`,
  );
  if (!a.ok || !Array.isArray(a.data) || !a.data.length) return null;
  if (a.data[0].role !== 'owner') return { id: a.data[0].user_id, isOwner: false };
  return { id: a.data[0].user_id, isOwner: true };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });
  const requester = await requireOwner(req);
  if (!requester) return json(req, res, 401, { error: 'Unauthorized' });
  if (!requester.isOwner)
    return json(req, res, 403, { error: 'هذا القسم متاح فقط لحساب الأدمن الرئيسي' });

  if (req.method === 'GET') {
    const r = await sbFetch(
      '/rest/v1/admin_users?select=user_id,email,display_name,role,permissions,created_at&order=created_at.asc',
    );
    if (!r.ok) return json(req, res, 502, { error: 'تعذر تحميل قائمة المستخدمين' });
    return json(req, res, 200, { users: r.data });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(req, res, 400, { error: 'Invalid JSON' });
    }
  }

  if (req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.display_name || '').trim() || null;
    if (!email || !email.includes('@'))
      return json(req, res, 400, { error: 'بريد إلكتروني غير صالح' });
    if (password.length < 8)
      return json(req, res, 400, { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    const permissions = normalizePermissions(body.permissions);

    const created = await sbFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!created.ok) {
      const msg =
        created.data?.msg || created.data?.message || created.data?.error_description || '';
      if (String(msg).toLowerCase().includes('already') || created.status === 422)
        return json(req, res, 409, { error: 'هذا البريد الإلكتروني مستخدم مسبقاً' });
      return json(req, res, 502, { error: 'تعذر إنشاء حساب المستخدم: ' + msg });
    }
    const newUserId = created.data?.id;
    if (!newUserId) return json(req, res, 502, { error: 'تعذر إنشاء حساب المستخدم' });

    const inserted = await sbFetch('/rest/v1/admin_users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: newUserId,
        email,
        display_name: displayName,
        role: 'staff',
        permissions,
        created_by: requester.id,
      }),
    });
    if (!inserted.ok) {
      // Roll back the auth user so we don't leave an orphaned login with no admin row.
      await sbFetch(`/auth/v1/admin/users/${encodeURIComponent(newUserId)}`, { method: 'DELETE' });
      return json(req, res, 502, { error: 'تعذر حفظ صلاحيات المستخدم' });
    }
    return json(req, res, 200, { user: inserted.data?.[0] || inserted.data });
  }

  if (req.method === 'PATCH') {
    const userId = String(body.user_id || '').trim();
    if (!userId) return json(req, res, 400, { error: 'معرف المستخدم مطلوب' });
    if (userId === requester.id)
      return json(req, res, 400, { error: 'لا يمكنك تعديل صلاحياتك الخاصة' });
    const existing = await sbFetch(
      `/rest/v1/admin_users?select=user_id,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    );
    const target = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
    if (!target) return json(req, res, 404, { error: 'المستخدم غير موجود' });
    if (target.role === 'owner')
      return json(req, res, 400, { error: 'لا يمكن تعديل صلاحيات الحساب الرئيسي' });

    const update = {};
    if (body.permissions !== undefined) update.permissions = normalizePermissions(body.permissions);
    if (body.display_name !== undefined) update.display_name = String(body.display_name || '').trim() || null;
    if (!Object.keys(update).length) return json(req, res, 400, { error: 'لا يوجد تعديل' });

    const r = await sbFetch(`/rest/v1/admin_users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(update),
    });
    if (!r.ok) return json(req, res, 502, { error: 'تعذر تحديث صلاحيات المستخدم' });
    return json(req, res, 200, { user: r.data?.[0] || r.data });
  }

  if (req.method === 'DELETE') {
    const q = new URL(req.url, 'http://veronza.local').searchParams;
    const userId = String(q.get('user_id') || '').trim();
    if (!userId) return json(req, res, 400, { error: 'معرف المستخدم مطلوب' });
    if (userId === requester.id)
      return json(req, res, 400, { error: 'لا يمكنك حذف حسابك الخاص' });
    const existing = await sbFetch(
      `/rest/v1/admin_users?select=user_id,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    );
    const target = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
    if (!target) return json(req, res, 404, { error: 'المستخدم غير موجود' });
    if (target.role === 'owner')
      return json(req, res, 400, { error: 'لا يمكن حذف الحساب الرئيسي' });

    const r = await sbFetch(`/rest/v1/admin_users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    if (!r.ok) return json(req, res, 502, { error: 'تعذر حذف المستخدم' });
    return json(req, res, 200, { ok: true });
  }

  res.setHeader('Allow', 'GET,POST,PATCH,DELETE');
  return json(req, res, 405, { error: 'Method not allowed' });
};
