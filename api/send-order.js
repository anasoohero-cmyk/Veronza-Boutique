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

  const token = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const templateName = process.env.META_TEMPLATE_NAME || 'veronza_order_received';
  const recipient = process.env.WHATSAPP_ORDER_RECIPIENT;

  if (!token || !phoneNumberId || !recipient) {
    return res.status(503).json({ ok: false, error: 'WhatsApp integration is not configured' });
  }

  const orderNumber = `VZ-${Date.now().toString().slice(-8)}`;
  const totalText = `${Number(total).toLocaleString('ar-LY')} د.ل`;

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

  const data = await graphResponse.json();

  if (!graphResponse.ok) {
    return res.status(502).json({ ok: false, error: data?.error?.message || 'WhatsApp API error' });
  }

  return res.status(200).json({
    ok: true,
    orderNumber,
    messageId: data?.messages?.[0]?.id || null
  });
};
