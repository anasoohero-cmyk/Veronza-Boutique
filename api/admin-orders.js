const { notifyAdmins } = require('./_push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const STATUS_LABELS = {
  pending: 'قيد المراجعة',
  confirmed: 'تم التأكيد',
  preparing: 'قيد التجهيز',
  shipped: 'جاري التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  returned: 'مرتجع',
};
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
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
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
  return {
    id: admin.user_id,
    role: admin.role,
    canView: admin.role === 'owner' || !!admin.permissions?.orders?.view,
    canEdit: admin.role === 'owner' || !!admin.permissions?.orders?.edit,
  };
}
function normalizeLibyanPhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '218' + p.slice(1);
  if (!p.startsWith('218') && p.length === 9) p = '218' + p;
  return p;
}
async function notifyCustomerStatusChange(order, newStatus) {
  if (!META_TOKEN || !META_PHONE_NUMBER_ID)
    return { sent: false, error: 'WhatsApp not configured' };
  const to = normalizeLibyanPhone(order.customer_phone);
  if (!to) return { sent: false, error: 'Invalid customer phone' };
  const templatePayload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'veronza_order_status_update',
      language: { code: 'ar' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: order.customer_name || 'عميلنا العزيز' },
            { type: 'text', text: order.order_number },
            { type: 'text', text: STATUS_LABELS[newStatus] || newStatus },
          ],
        },
      ],
    },
  };
  try {
    const r = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(META_PHONE_NUMBER_ID)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(templatePayload),
      },
    );
    if (!r.ok) return { sent: false, error: (await r.text()).slice(0, 500) };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e?.message || e).slice(0, 500) };
  }
}
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });
  const user = await requireAdmin(req);
  if (!user) return json(req, res, 401, { error: 'Unauthorized' });
  if (!user.canView) return json(req, res, 403, { error: 'لا تملك صلاحية الوصول لقسم الطلبات' });
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://veronza.local').searchParams;
    const id = q.get('order_id');
    if (id) {
      const r = await sbFetch(
        `/rest/v1/order_items?select=id,product_code,product_name,color,size,quantity,unit_price,image_url,created_at&order_id=eq.${encodeURIComponent(id)}&order=created_at.asc`,
      );
      if (!r.ok) return json(req, res, 502, { error: 'Could not load order items' });
      return json(req, res, 200, { items: r.data });
    }
    const r = await sbFetch(
      '/rest/v1/orders?select=id,order_number,user_id,customer_name,customer_phone,customer_address,total,status,admin_notes,created_at,updated_at,whatsapp_status,whatsapp_last_error,whatsapp_sent_at&order=created_at.desc',
    );
    if (!r.ok) return json(req, res, 502, { error: 'Could not load orders' });
    return json(req, res, 200, { orders: r.data });
  }
  // Creates a real order (linked to stock, with a real order number) for a
  // customer who called in rather than ordering through the site.
  if (req.method === 'POST') {
    if (!user.canEdit) return json(req, res, 403, { error: 'لا تملك صلاحية إنشاء الطلبات' });
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
      const isSized = ['shoes', 'set'].includes(String(product.type).toLowerCase());
      if (isSized && !size) return json(req, res, 400, { error: `المقاس مطلوب لـ ${code}` });
      if (
        size &&
        isSized &&
        Array.isArray(product.sizes) &&
        product.sizes.length &&
        !product.sizes.includes(size)
      )
        return json(req, res, 400, { error: `مقاس غير صالح لـ ${code}` });
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
  }
  if (req.method === 'PATCH') {
    if (!user.canEdit) return json(req, res, 403, { error: 'لا تملك صلاحية تعديل الطلبات' });
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return json(req, res, 400, { error: 'Invalid JSON' });
      }
    }
    const allowed = [
      'pending',
      'confirmed',
      'preparing',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
    ];
    if (!body.id || !allowed.includes(body.status))
      return json(req, res, 400, { error: 'Invalid order or status' });
    const existing = await sbFetch(
      `/rest/v1/orders?select=id,order_number,customer_name,customer_phone,status,stock_decremented&id=eq.${encodeURIComponent(body.id)}&limit=1`,
    );
    const previousOrder = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
    if (!previousOrder) return json(req, res, 404, { error: 'الطلب غير موجود' });

    // Stock stays decremented only while an order sits in "shipped"/"delivered".
    // Moving into either of those (from anywhere) decrements it; moving out of
    // them to any other status (preparing, cancelled, returned, ...) restores it.
    const isShippedOrDelivered = ['shipped', 'delivered'].includes(body.status);

    if (isShippedOrDelivered && !previousOrder.stock_decremented) {
      const dec = await sbFetch('/rest/v1/rpc/decrement_stock_for_order', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: body.id }),
      });
      if (!dec.ok) {
        const detail = typeof dec.data === 'string' ? dec.data : JSON.stringify(dec.data || '');
        if (detail.includes('INSUFFICIENT_STOCK'))
          return json(req, res, 409, {
            error: 'الكمية غير متوفرة في المخزون لإتمام هذا الطلب — راجع الكميات المتاحة.',
          });
        return json(req, res, 502, { error: 'تعذر خصم الكمية من المخزون' });
      }
    } else if (!isShippedOrDelivered && previousOrder.stock_decremented) {
      const rest = await sbFetch('/rest/v1/rpc/restore_stock_for_order', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: body.id }),
      });
      if (!rest.ok) return json(req, res, 502, { error: 'تعذر إرجاع الكمية إلى المخزون' });
    }

    const adminNotes = body.admin_notes == null ? null : String(body.admin_notes);
    const r = await sbFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: body.status,
        admin_notes: adminNotes,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) return json(req, res, 502, { error: 'Could not update order' });
    const updatedOrder = Array.isArray(r.data) ? r.data[0] : r.data;
    let notify = null;
    if (previousOrder && previousOrder.status !== body.status) {
      notify = await notifyCustomerStatusChange(updatedOrder, body.status);
      if (!notify.sent) console.error('Status WhatsApp notify failed:', notify.error);
    }
    return json(req, res, 200, { order: updatedOrder, notify });
  }
  res.setHeader('Allow', 'GET,POST,PATCH');
  return json(req, res, 405, { error: 'Method not allowed' });
};
