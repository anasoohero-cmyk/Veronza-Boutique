const webpush = require('web-push');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders); res.end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { customer = {}, items = [], total = 0 } = req.body || {};
  const name = String(customer.name || '').trim(); const phone = String(customer.phone || '').trim(); const address = String(customer.address || '').trim();
  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: 'Missing order data' });
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY, metaToken = process.env.META_ACCESS_TOKEN, phoneNumberId = process.env.META_PHONE_NUMBER_ID, recipient = process.env.WHATSAPP_ORDER_RECIPIENT;
  if (!supabaseUrl || !serviceKey || !metaToken || !phoneNumberId || !recipient) return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) return res.status(400).json({ ok: false, error: 'Invalid idempotency key' });
  let userId = null; const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && /^Bearer\s+/i.test(authHeader)) { const token = authHeader.replace(/^Bearer\s+/i, '').trim(); try { const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey, Authorization: `Bearer ${token}` } }); if (r.ok) userId = (await r.json())?.id || null; } catch (_) {} }
  const normalizedItems = [];
  for (const rawItem of items) {
    const code = String(rawItem.code || rawItem.product_code || '').trim(); const rawQty = Number(rawItem.qty ?? rawItem.quantity); const qty = Number.isInteger(rawQty) ? rawQty : NaN;
    if (!code || !Number.isInteger(qty) || qty < 1) return res.status(400).json({ ok: false, error: 'Invalid order item' });
    const productResp = await fetch(`${supabaseUrl}/rest/v1/products?select=id,code,name,price,img,type,colors,sizes&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`, { headers });
    if (!productResp.ok) return res.status(502).json({ ok: false, error: 'Product lookup failed' });
    const product = (await productResp.json())[0]; if (!product) return res.status(400).json({ ok: false, error: `Invalid product: ${code}` });
    const color = rawItem.color == null ? null : String(rawItem.color).trim() || null; const size = rawItem.size == null ? null : String(rawItem.size).trim() || null;
    if (color && Array.isArray(product.colors) && product.colors.length && !product.colors.includes(color)) return res.status(400).json({ ok: false, error: `Invalid color for ${code}` });
    if (size && ['shoes', 'set'].includes(String(product.type).toLowerCase()) && Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(size)) return res.status(400).json({ ok: false, error: `Invalid size for ${code}` });
    normalizedItems.push({ product_code: product.code, product_name: product.name, color, size, quantity: qty, unit_price: Number(product.price) || 0, image_url: product.img || null, type: product.type || null });
  }
  const serverTotal = normalizedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0); if (Number(total) !== serverTotal) return res.status(400).json({ ok: false, error: 'Order total mismatch' });
  if (!normalizedItems.find(item => item.image_url)?.image_url) return res.status(400).json({ ok: false, error: 'Product image missing' });
  const orderNumber = `VZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const rpcResp = await fetch(`${supabaseUrl}/rest/v1/rpc/place_order_atomic`, { method: 'POST', headers, body: JSON.stringify({ p_order_number: orderNumber, p_customer_name: name, p_customer_phone: phone, p_customer_address: address, p_total: serverTotal, p_items: normalizedItems, p_user_id: userId, p_idempotency_key: idempotencyKey }) });
  if (!rpcResp.ok) return res.status(409).json({ ok: false, error: 'Insufficient stock or order could not be reserved', detail: await rpcResp.text() });
  const orderId = await rpcResp.json();
  const existingResp = await fetch(`${supabaseUrl}/rest/v1/orders?select=id,order_number,whatsapp_status,whatsapp_last_error,whatsapp_sent_at&id=eq.${encodeURIComponent(orderId)}&limit=1`, { headers });
  if (!existingResp.ok) return res.status(502).json({ ok: false, error: 'Order lookup failed' });
  const existingOrder = (await existingResp.json())[0];
  if (!existingOrder) return res.status(502).json({ ok: false, error: 'Order not found after reservation' });
  const finalOrderNumber = existingOrder.order_number || orderNumber;

  const adminResp = await fetch(`${supabaseUrl}/rest/v1/admin_users?select=user_id`, { headers });
  if (adminResp.ok) {
    const admins = await adminResp.json();
    const notificationRows = admins.map(a => ({ admin_user_id: a.user_id, type: 'order', title: 'طلب جديد', body: `${finalOrderNumber} · ${name} · ${serverTotal.toLocaleString('ar-LY')} د.ل`, order_id: orderId }));
    if (notificationRows.length) await fetch(`${supabaseUrl}/rest/v1/notifications`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(notificationRows) }).catch(()=>{});

    try {
      const cfgResp = await fetch(`${supabaseUrl}/rest/v1/push_config?select=vapid_public_key,vapid_private_key&id=eq.true&limit=1`, { headers });
      const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
      const subsResp = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?select=id,admin_user_id,endpoint,subscription`, { headers });
      const subscriptions = subsResp.ok ? await subsResp.json() : [];
      if (cfg && subscriptions.length) {
        webpush.setVapidDetails('mailto:veronza@localhost', cfg.vapid_public_key, cfg.vapid_private_key);
        await Promise.all(subscriptions.map(async sub => {
          try { await webpush.sendNotification(sub.subscription, JSON.stringify({ title: 'طلب جديد في VERONZA', body: `${finalOrderNumber} · ${name} · ${serverTotal.toLocaleString('ar-LY')} د.ل`, url: '/' })); }
          catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`, { method: 'DELETE', headers }).catch(()=>{}); }
        }));
      }
    } catch (e) { console.error('Push notification failed:', e?.message || e); }
  }

  if (idempotencyKey && existingOrder.whatsapp_status === 'sent') return res.status(200).json({ ok: true, order_id: existingOrder.id, order_number: existingOrder.order_number, whatsapp_status: 'sent' });
  const messageText = [`طلب جديد ${finalOrderNumber}`, `الاسم: ${name}`, `الهاتف: ${phone}`, `العنوان: ${address}`, `الإجمالي: ${serverTotal}`, '', ...normalizedItems.map((item, index) => `${index + 1}) ${item.product_name} | ${item.product_code} | الكمية: ${item.quantity}${item.color ? ` | اللون: ${item.color}` : ''}${item.size ? ` | المقاس: ${item.size}` : ''}`)].join('\n');
  const patchOrder = async (payload) => { let lastError = null; for (let attempt = 1; attempt <= 3; attempt++) { try { const r = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(payload) }); if (r.ok) return true; lastError = await r.text(); } catch (e) { lastError = String(e?.message || e); } if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * attempt)); } console.error('Failed to update order WhatsApp status', lastError); return false; };
  let whatsappError = null;
  try { const waResp = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: messageText } }) }); if (!waResp.ok) whatsappError = (await waResp.text()).slice(0, 2000); } catch (e) { whatsappError = String(e?.message || e).slice(0, 2000); }
  if (whatsappError) { await patchOrder({ whatsapp_status: 'failed', whatsapp_last_error: whatsappError }); return res.status(502).json({ ok: false, error: 'Order was reserved, but WhatsApp delivery failed', order_id: orderId, order_number: finalOrderNumber, whatsapp_status: 'failed' }); }
  const sent = await patchOrder({ whatsapp_status: 'sent', whatsapp_last_error: null, whatsapp_sent_at: new Date().toISOString() });
  if (!sent) console.error('WhatsApp was sent but status could not be persisted');
  return res.status(200).json({ ok: true, order_id: orderId, order_number: finalOrderNumber, whatsapp_status: 'sent' });
};
