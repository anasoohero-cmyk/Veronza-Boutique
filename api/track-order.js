module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const phone = String(req.query.phone || '').trim();
  const orderNumber = String(req.query.order_number || '').trim();
  if (!phone || !orderNumber) return res.status(400).json({ ok: false, error: 'رقم الهاتف ورقم الطلب مطلوبين' });

  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const orderResp = await fetch(
    `${supabaseUrl}/rest/v1/orders?select=id,order_number,status,total,customer_name,created_at&order_number=eq.${encodeURIComponent(orderNumber)}&customer_phone=eq.${encodeURIComponent(phone)}&limit=1`,
    { headers }
  );
  if (!orderResp.ok) return res.status(502).json({ ok: false, error: 'Lookup failed' });
  const rows = await orderResp.json();
  const order = rows[0];
  if (!order) return res.status(404).json({ ok: false, error: 'ما لقيناش طلب بهذا الرقم وهذا الهاتف' });

  const itemsResp = await fetch(
    `${supabaseUrl}/rest/v1/order_items?select=product_name,product_code,color,size,quantity,unit_price,image_url&order_id=eq.${encodeURIComponent(order.id)}`,
    { headers }
  );
  const items = itemsResp.ok ? await itemsResp.json() : [];

  return res.status(200).json({ ok: true, order: { ...order, items } });
};
