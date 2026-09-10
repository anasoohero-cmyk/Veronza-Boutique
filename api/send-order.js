module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { customer = {}, items = [], total = 0 } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();
  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: 'Missing order data' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const recipient = process.env.WHATSAPP_ORDER_RECIPIENT;
  if (!supabaseUrl || !serviceKey || !metaToken || !phoneNumberId || !recipient) return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  let userId = null;
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey, Authorization: `Bearer ${token}` } });
      if (userResp.ok) userId = (await userResp.json())?.id || null;
    } catch (_) {}
  }

  const normalizedItems = [];
  for (const rawItem of items) {
    const code = String(rawItem.code || rawItem.product_code || '').trim();
    const qty = Math.max(1, Number(rawItem.qty ?? rawItem.quantity) || 0);
    if (!code || !Number.isInteger(qty) || qty < 1) return res.status(400).json({ ok: false, error: 'Invalid order item' });
    const productResp = await fetch(`${supabaseUrl}/rest/v1/products?select=id,code,name,price,img,type,colors,sizes&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`, { headers });
    if (!productResp.ok) return res.status(502).json({ ok: false, error: 'Product lookup failed' });
    const product = (await productResp.json())[0];
    if (!product) return res.status(400).json({ ok: false, error: `Invalid product: ${code}` });
    const color = rawItem.color == null ? null : String(rawItem.color).trim() || null;
    const size = rawItem.size == null ? null : String(rawItem.size).trim() || null;
    if (color && Array.isArray(product.colors) && product.colors.length && !product.colors.includes(color)) return res.status(400).json({ ok: false, error: `Invalid color for ${code}` });
    if (size && ['shoe', 'set'].includes(String(product.type).toLowerCase()) && Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(size)) return res.status(400).json({ ok: false, error: `Invalid size for ${code}` });
    normalizedItems.push({ product_code: product.code, product_name: product.name, color, size, quantity: qty, unit_price: Number(product.price) || 0, image_url: product.img || null, type: product.type || null });
  }

  const serverTotal = normalizedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  if (Number(total) !== serverTotal) return res.status(400).json({ ok: false, error: 'Order total mismatch' });
  const firstImage = normalizedItems.find(item => item.image_url)?.image_url;
  if (!firstImage) return res.status(400).json({ ok: false, error: 'Product image missing' });

  const orderNumber = `VZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const rpcResp = await fetch(`${supabaseUrl}/rest/v1/rpc/place_order_atomic`, { method: 'POST', headers, body: JSON.stringify({ p_order_number: orderNumber, p_customer_name: name, p_customer_phone: phone, p_customer_address: address, p_total: serverTotal, p_items: normalizedItems, p_user_id: userId }) });
  if (!rpcResp.ok) return res.status(409).json({ ok: false, error: 'Insufficient stock or order could not be reserved', detail: await rpcResp.text() });
  const orderId = await rpcResp.json();

  const messageText = [`طلب جديد ${orderNumber}`, `الاسم: ${name}`, `الهاتف: ${phone}`, `العنوان: ${address}`, `الإجمالي: ${serverTotal}`, '', ...normalizedItems.map((item, index) => `${index + 1}) ${item.product_name} | ${item.product_code} | الكمية: ${item.quantity}${item.color ? ` | اللون: ${item.color}` : ''}${item.size ? ` | المقاس: ${item.size}` : ''}`)].join('\n');
  const waResp = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: messageText } }) });
  if (!waResp.ok) return res.status(502).json({ ok: false, error: 'WhatsApp delivery failed', detail: await waResp.text() });
  return res.status(200).json({ ok: true, order_id: orderId, order_number: orderNumber });
};
