module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const {
    customer = {},
    items = [],
    total = 0,
  } = req.body || {};

  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();

  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing order data' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const recipient = process.env.WHATSAPP_ORDER_RECIPIENT;

  if (!supabaseUrl || !serviceKey || !metaToken || !phoneNumberId || !recipient) {
    return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  let userId = null;
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey,
          Authorization: `Bearer ${token}`,
        },
      });
      if (userResp.ok) {
        const user = await userResp.json();
        userId = user?.id || null;
      }
    } catch (_) {
      userId = null;
    }
  }

  const normalizedItems = [];
  for (const rawItem of items) {
    const code = String(rawItem.code || rawItem.product_code || '').trim();
    const rawQty = Number(rawItem.qty ?? rawItem.quantity);
    const qty = Number.isInteger(rawQty) ? rawQty : NaN;
    if (!code || !Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid order item' });
    }

    const productResp = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,code,name,price,img,type,colors,sizes&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`,
      { headers }
    );
    if (!productResp.ok) {
      return res.status(502).json({ ok: false, error: 'Product lookup failed' });
    }

    const products = await productResp.json();
    const product = products[0];
    if (!product) {
      return res.status(400).json({ ok: false, error: `Invalid product: ${code}` });
    }

    const color = rawItem.color == null ? null : String(rawItem.color).trim() || null;
    const size = rawItem.size == null ? null : String(rawItem.size).trim() || null;

    if (color && Array.isArray(product.colors) && product.colors.length && !product.colors.includes(color)) {
      return res.status(400).json({ ok: false, error: `Invalid color for ${code}` });
    }
    if (size && ['shoe', 'set'].includes(String(product.type).toLowerCase()) && Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(size)) {
      return res.status(400).json({ ok: false, error: `Invalid size for ${code}` });
    }

    normalizedItems.push({
      product_code: product.code,
      product_name: product.name,
      color,
      size,
      quantity: qty,
      unit_price: Number(product.price) || 0,
      image_url: product.img || null,
      type: product.type || null,
    });
  }

  const serverTotal = normalizedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  if (Number(total) !== serverTotal) {
    return res.status(400).json({ ok: false, error: 'Order total mismatch' });
  }

  const firstImage = normalizedItems.find(item => item.image_url)?.image_url;
  if (!firstImage) {
    return res.status(400).json({ ok: false, error: 'Product image missing' });
  }

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
    }),
  });

  if (!rpcResp.ok) {
    const detail = await rpcResp.text();
    return res.status(409).json({ ok: false, error: 'Insufficient stock or order could not be reserved', detail });
  }

  const orderId = await rpcResp.json();

  const messageText = [
    `طلب جديد ${orderNumber}`,
    `الاسم: ${name}`,
    `الهاتف: ${phone}`,
    `العنوان: ${address}`,
    `الإجمالي: ${serverTotal}`,
    '',
    ...normalizedItems.map((item, index) =>
      `${index + 1}) ${item.product_name} | ${item.product_code} | الكمية: ${item.quantity}${item.color ? ` | اللون: ${item.color}` : ''}${item.size ? ` | المقاس: ${item.size}` : ''}`
    ),
  ].join('\n');

  let whatsappError = null;
  try {
    const waResp = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${metaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: messageText },
      }),
    });

    if (!waResp.ok) {
      whatsappError = (await waResp.text()).slice(0, 2000);
    }
  } catch (error) {
    whatsappError = String(error?.message || error).slice(0, 2000);
  }

  if (whatsappError) {
    const updateResp = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          whatsapp_status: 'failed',
          whatsapp_last_error: whatsappError,
        }),
      }
    );

    if (!updateResp.ok) {
      console.error('Failed to record WhatsApp delivery failure', await updateResp.text());
    }

    return res.status(502).json({
      ok: false,
      error: 'Order was reserved, but WhatsApp delivery failed',
      order_id: orderId,
      order_number: orderNumber,
      whatsapp_status: 'failed',
    });
  }

  const sentUpdateResp = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        whatsapp_status: 'sent',
        whatsapp_last_error: null,
        whatsapp_sent_at: new Date().toISOString(),
      }),
    }
  );

  if (!sentUpdateResp.ok) {
    console.error('Failed to record WhatsApp sent status', await sentUpdateResp.text());
  }

  return res.status(200).json({
    ok: true,
    order_id: orderId,
    order_number: orderNumber,
    whatsapp_status: 'sent',
  });
};
