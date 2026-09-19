const { notifyAdmins } = require('./_push');

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    Vary: 'Origin',
  };
  const origin = allowedOrigin(req);
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { customer = {}, items = [], total = 0 } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();
  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Missing order data' });
  const supabaseUrl = process.env.SUPABASE_URL,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    metaToken = process.env.META_ACCESS_TOKEN,
    phoneNumberId = process.env.META_PHONE_NUMBER_ID,
    recipient = process.env.WHATSAPP_ORDER_RECIPIENT;
  if (!supabaseUrl || !serviceKey || !metaToken || !phoneNumberId || !recipient)
    return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200)
    return res.status(400).json({ ok: false, error: 'Invalid idempotency key' });
  let userId = null;
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey:
            process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey,
          Authorization: `Bearer ${token}`,
        },
      });
      if (r.ok) userId = (await r.json())?.id || null;
    } catch (_) {}
  }
  const normalizedItems = [];
  for (const rawItem of items) {
    const code = String(rawItem.code || rawItem.product_code || '').trim();
    const rawQty = Number(rawItem.qty ?? rawItem.quantity);
    const qty = Number.isInteger(rawQty) ? rawQty : NaN;
    if (!code || !Number.isInteger(qty) || qty < 1)
      return res.status(400).json({ ok: false, error: 'Invalid order item' });
    const productResp = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,code,name,price,discount_price,img,type,colors,sizes&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`,
      { headers },
    );
    if (!productResp.ok) return res.status(502).json({ ok: false, error: 'Product lookup failed' });
    const product = (await productResp.json())[0];
    if (!product) return res.status(400).json({ ok: false, error: `Invalid product: ${code}` });
    const color = rawItem.color == null ? null : String(rawItem.color).trim() || null;
    const size = rawItem.size == null ? null : String(rawItem.size).trim() || null;
    if (
      color &&
      Array.isArray(product.colors) &&
      product.colors.length &&
      !product.colors.includes(color)
    )
      return res.status(400).json({ ok: false, error: `Invalid color for ${code}` });
    if (
      size &&
      ['shoes', 'set'].includes(String(product.type).toLowerCase()) &&
      Array.isArray(product.sizes) &&
      product.sizes.length &&
      !product.sizes.includes(size)
    )
      return res.status(400).json({ ok: false, error: `Invalid size for ${code}` });
    const basePrice = Number(product.price) || 0;
    const discountPrice = product.discount_price != null ? Number(product.discount_price) : null;
    const unitPrice = discountPrice != null && discountPrice < basePrice ? discountPrice : basePrice;
    normalizedItems.push({
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      color,
      size,
      quantity: qty,
      unit_price: unitPrice,
      image_url: product.img || null,
      type: product.type || null,
    });
  }
  const serverTotal = normalizedItems.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  );
  if (Number(total) !== serverTotal)
    return res.status(400).json({ ok: false, error: 'Order total mismatch' });
  if (!normalizedItems.find((item) => item.image_url)?.image_url)
    return res.status(400).json({ ok: false, error: 'Product image missing' });
  const orderNumber = `VZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const rpcResp = await fetch(`${supabaseUrl}/rest/v1/rpc/place_order_atomic`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_order_number: orderNumber,
      p_customer_name: name,
      p_customer_phone: phone,
      p_customer_address: address,
      p_total: serverTotal,
      p_items: normalizedItems,
      p_user_id: userId,
      p_idempotency_key: idempotencyKey,
    }),
  });
  if (!rpcResp.ok)
    return res
      .status(409)
      .json({
        ok: false,
        error: 'Insufficient stock or order could not be reserved',
        detail: await rpcResp.text(),
      });
  const orderId = await rpcResp.json();
  const existingResp = await fetch(
    `${supabaseUrl}/rest/v1/orders?select=id,order_number,whatsapp_status,whatsapp_last_error,whatsapp_sent_at&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { headers },
  );
  if (!existingResp.ok) return res.status(502).json({ ok: false, error: 'Order lookup failed' });
  const existingOrder = (await existingResp.json())[0];
  if (!existingOrder)
    return res.status(502).json({ ok: false, error: 'Order not found after reservation' });
  const finalOrderNumber = existingOrder.order_number || orderNumber;

  await notifyAdmins(supabaseUrl, serviceKey, {
    type: 'order',
    title: 'طلب جديد',
    body: `${finalOrderNumber} · ${name} · ${serverTotal.toLocaleString('ar-LY')} د.ل`,
    orderId,
    url: `/admin.html?order=${encodeURIComponent(orderId)}`,
  });

  if (idempotencyKey && existingOrder.whatsapp_status === 'sent')
    return res
      .status(200)
      .json({
        ok: true,
        order_id: existingOrder.id,
        order_number: existingOrder.order_number,
        whatsapp_status: 'sent',
      });
  const patchOrder = async (payload) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
          {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify(payload),
          },
        );
        if (r.ok) return true;
        lastError = await r.text();
      } catch (e) {
        lastError = String(e?.message || e);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    console.error('Failed to update order WhatsApp status', lastError);
    return false;
  };
  const normalizeLibyanPhone = (raw) => {
    let p = String(raw || '').replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('0')) p = '218' + p.slice(1);
    if (!p.startsWith('218') && p.length === 9) p = '218' + p;
    return p;
  };
  const siteUrl =
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://veronza.vercel.app');
  const sendWhatsAppMessage = async (payload) => {
    const r = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!r.ok) console.error('WhatsApp free-form message failed:', (await r.text()).slice(0, 500));
    return r.ok;
  };
  const sendAdminFullDetails = async () => {
    try {
      const summaryLines = [
        `📦 طلب جديد: ${finalOrderNumber}`,
        `👤 الزبون: ${name}`,
        `📞 الهاتف: ${phone}`,
        `📍 العنوان: ${address}`,
        `💰 الإجمالي: ${serverTotal.toLocaleString('ar-LY')} د.ل`,
      ].join('\n');
      await sendWhatsAppMessage({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: summaryLines },
      });
      for (const item of normalizedItems) {
        const variant = [item.color, item.size].filter(Boolean).join(' / ') || 'موحد';
        const productLink = item.product_id ? `${siteUrl}/?p=${item.product_id}` : '';
        const caption = [
          `🛍 ${item.product_name}`,
          `الكود: ${item.product_code}`,
          `اللون/المقاس: ${variant}`,
          `الكمية: ${item.quantity}`,
          `السعر: ${item.unit_price.toLocaleString('ar-LY')} د.ل`,
          productLink ? `الرابط: ${productLink}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        if (item.image_url)
          await sendWhatsAppMessage({
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'image',
            image: { link: item.image_url, caption },
          });
        else
          await sendWhatsAppMessage({
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'text',
            text: { body: caption },
          });
      }
    } catch (e) {
      console.error('Admin full-details WhatsApp error:', e?.message || e);
    }
  };
  const sendCustomerConfirmation = async () => {
    try {
      const to = normalizeLibyanPhone(phone);
      if (!to) return;
      const heroItem = normalizedItems[0] || {};
      const variant = [heroItem.color, heroItem.size].filter(Boolean).join(' / ') || 'موحد';
      const heroImage = heroItem.image_url || normalizedItems.find((it) => it.image_url)?.image_url;
      const components = [];
      if (heroImage)
        components.push({
          type: 'header',
          parameters: [{ type: 'image', image: { link: heroImage } }],
        });
      components.push({
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: finalOrderNumber },
          { type: 'text', text: heroItem.product_name || 'منتجك' },
          { type: 'text', text: variant },
          { type: 'text', text: String(heroItem.unit_price ?? '') },
          { type: 'text', text: String(serverTotal) },
        ],
      });
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: 'veronza_order_confirmed', language: { code: 'ar' }, components },
      };
      const r = await fetch(
        `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!r.ok)
        console.error('Customer confirmation WhatsApp failed:', (await r.text()).slice(0, 500));
    } catch (e) {
      console.error('Customer confirmation WhatsApp error:', e?.message || e);
    }
  };
  let whatsappError = null;
  try {
    const templatePayload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: 'veronza_order_received',
        language: { code: 'ar' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: phone },
              { type: 'text', text: address },
              { type: 'text', text: finalOrderNumber },
              { type: 'text', text: String(serverTotal) },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: String(orderId) }],
          },
        ],
      },
    };
    const waResp = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(templatePayload),
      },
    );
    if (!waResp.ok) whatsappError = (await waResp.text()).slice(0, 2000);
  } catch (e) {
    whatsappError = String(e?.message || e).slice(0, 2000);
  }
  if (whatsappError) {
    await patchOrder({ whatsapp_status: 'failed', whatsapp_last_error: whatsappError });
    return res
      .status(502)
      .json({
        ok: false,
        error: 'Order was reserved, but WhatsApp delivery failed',
        order_id: orderId,
        order_number: finalOrderNumber,
        whatsapp_status: 'failed',
      });
  }
  const sent = await patchOrder({
    whatsapp_status: 'sent',
    whatsapp_last_error: null,
    whatsapp_sent_at: new Date().toISOString(),
  });
  if (!sent) console.error('WhatsApp was sent but status could not be persisted');
  await sendAdminFullDetails();
  await sendCustomerConfirmation();
  return res
    .status(200)
    .json({ ok: true, order_id: orderId, order_number: finalOrderNumber, whatsapp_status: 'sent' });
};
