const { notifyAdmins } = require('./_push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const u = await sbFetch('/auth/v1/user', {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
  });
  if (!u.ok || !u.data?.id) return null;
  const a = await sbFetch(
    `/rest/v1/admin_users?select=user_id,role,permissions&user_id=eq.${encodeURIComponent(u.data.id)}&limit=1`,
  );
  if (!a.ok || !Array.isArray(a.data) || !a.data.length) return null;
  const admin = a.data[0];
  return { id: admin.user_id, canEdit: admin.role === 'owner' || !!admin.permissions?.orders?.edit };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(req, res, 405, { error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });

  const admin = await requireAdmin(req);
  if (!admin) return json(req, res, 401, { error: 'Unauthorized' });
  if (!admin.canEdit) return json(req, res, 403, { error: 'لا تملك صلاحية إنشاء الطلبات' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(req, res, 400, { error: 'Invalid JSON' });
    }
  }
  const name = String(body.customer_name || '').trim();
  const phone = String(body.customer_phone || '').trim();
  const address = String(body.customer_address || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!name || !phone || !address || !items.length)
    return json(req, res, 400, { error: 'بيانات الطلب غير مكتملة' });

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const normalizedItems = [];
  for (const rawItem of items) {
    const code = String(rawItem.product_code || '').trim();
    const qty = Number(rawItem.quantity);
    if (!code || !Number.isInteger(qty) || qty < 1)
      return json(req, res, 400, { error: 'عنصر غير صالح في الطلب' });
    const productResp = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=id,code,name,price,discount_price,img,type,colors,sizes&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`,
      { headers },
    );
    if (!productResp.ok) return json(req, res, 502, { error: 'تعذر التحقق من المنتج' });
    const product = (await productResp.json())[0];
    if (!product) return json(req, res, 400, { error: `منتج غير صالح: ${code}` });
    const color = rawItem.color ? String(rawItem.color).trim() || null : null;
    const size = rawItem.size ? String(rawItem.size).trim() || null : null;
    const basePrice = Number(product.price) || 0;
    const discountPrice = product.discount_price != null ? Number(product.discount_price) : null;
    const unitPrice = discountPrice != null && discountPrice < basePrice ? discountPrice : basePrice;
    normalizedItems.push({
      product_code: product.code,
      product_name: product.name,
      color,
      size,
      quantity: qty,
      unit_price: unitPrice,
      image_url: product.img || null,
    });
  }
  const total = normalizedItems.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);

  const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_order_atomic`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_order_number: '',
      p_customer_name: name,
      p_customer_phone: phone,
      p_customer_address: address,
      p_total: total,
      p_items: normalizedItems,
      p_user_id: null,
      p_idempotency_key: null,
    }),
  });
  if (!rpcResp.ok)
    return json(req, res, 409, {
      error: 'تعذر إنشاء الطلب — تأكد من توفر الكمية المطلوبة',
      detail: await rpcResp.text(),
    });
  const orderId = await rpcResp.json();
  const orderResp = await sbFetch(
    `/rest/v1/orders?select=id,order_number&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orderResp.ok && Array.isArray(orderResp.data) ? orderResp.data[0] : null;
  if (!order) return json(req, res, 502, { error: 'تم إنشاء الطلب لكن تعذر قراءته' });

  await notifyAdmins(SUPABASE_URL, SERVICE_KEY, {
    type: 'order',
    title: 'طلب يدوي جديد',
    body: `${order.order_number} · ${name} · ${total.toLocaleString('ar-LY')} د.ل`,
    orderId,
    url: '/admin.html',
  });

  return json(req, res, 200, { order_id: orderId, order_number: order.order_number });
};
