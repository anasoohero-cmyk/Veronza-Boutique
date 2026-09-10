module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const {
    customer = {},
    items = [],
    total = 0
  } = req.body || {};

  if (!customer.name || !customer.phone || !customer.address || !items.length) {
    return res.status(400).json({ ok: false, error: 'Missing order data' });
  }

  const normalizedItems = items.map((item) => {
    const code = String(item.code || '').trim();
    const img = String(item.img || '').trim();
    const productUrl = String(item.productUrl || (code ? `https://veronza-boutique.vercel.app/product/${encodeURIComponent(code)}/` : '')).trim();
    return {
      ...item,
      code,
      img,
      productUrl
    };
  });

  const invalidItem = normalizedItems.find((item) => !item.code || !item.img || !item.productUrl);
  if (invalidItem) {
    return res.status(400).json({
      ok: false,
      error: 'Every order item must include a product code, image URL, and product URL'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://kahbxvbirsjmednkybse.supabase.co';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceRoleKey) {
    return res.status(503).json({ ok: false, error: 'Supabase order integration is not configured' });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const templateName = process.env.META_TEMPLATE_NAME || 'veronza_order_received';
  const recipient = process.env.WHATSAPP_ORDER_RECIPIENT;

  if (!token || !phoneNumberId || !recipient) {
    return res.status(503).json({ ok: false, error: 'WhatsApp integration is not configured' });
  }

  const orderNumber = `VZ-${Date.now().toString().slice(-8)}`;
  const totalText = `${Number(total).toLocaleString('ar-LY')} د.ل`;
  const firstItem = normalizedItems[0];

  const orderResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/place_order_atomic`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_order_number: orderNumber,
      p_customer_name: String(customer.name).slice(0, 200),
      p_customer_phone: String(customer.phone).slice(0, 50),
      p_customer_address: String(customer.address).slice(0, 500),
      p_total: Number(total),
      p_items: normalizedItems.map((item) => ({
        product_code: item.code,
        product_name: String(item.name || '').slice(0, 200),
        color: String(item.color || ''),
        size: String(item.size || ''),
        quantity: Math.max(1, Number(item.qty) || 0),
        unit_price: Number(item.price) || 0,
        image_url: item.img
      }))
    })
  });

  const orderData = await orderResponse.json().catch(() => null);
  if (!orderResponse.ok) {
    const message = typeof orderData === 'string' ? orderData : (orderData?.message || orderData?.hint || 'Stock is no longer available');
    return res.status(409).json({ ok: false, error: message });
  }

  const graphResponse = await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'ar' },
        components: [
          {
            type: 'header',
            parameters: [
              { type: 'image', image: { link: firstItem.img } }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: String(customer.name).slice(0, 100) },
              { type: 'text', text: orderNumber },
              { type: 'text', text: totalText }
            ]
          }
        ]
      }
    })
  });

  const data = await graphResponse.json().catch(() => ({}));

  if (!graphResponse.ok) {
    return res.status(502).json({ ok: false, error: data?.error?.message || 'WhatsApp API error' });
  }

  return res.status(200).json({
    ok: true,
    orderNumber,
    messageId: data?.messages?.[0]?.id || null,
    productUrl: firstItem.productUrl,
    imageUrl: firstItem.img,
    orderId: orderData
  });
};