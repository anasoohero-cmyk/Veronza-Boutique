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
    'Access-Control-Allow-Headers': 'Content-Type',
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

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(req, res, 400, { error: 'Invalid JSON' });
    }
  }
  const conversationId = String(body.conversation_id || '').trim();
  if (!conversationId) return json(req, res, 400, { error: 'conversation_id required' });

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  // Only notify for a conversation that actually exists — a stranger guessing
  // random ids should not be able to spam admin phones with fake call alerts.
  const convResp = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?select=id,customer_name&id=eq.${encodeURIComponent(conversationId)}&limit=1`,
    { headers },
  );
  if (!convResp.ok) return json(req, res, 502, { error: 'Lookup failed' });
  const conversation = (await convResp.json())[0];
  if (!conversation) return json(req, res, 404, { error: 'Conversation not found' });

  const customerName = conversation.customer_name || 'زائر';
  await notifyAdmins(SUPABASE_URL, SERVICE_KEY, {
    type: 'call',
    title: 'مكالمة واردة 📞',
    body: `${customerName} يتصل بك الآن من الشات`,
    url: `/admin-chat.html?c=${encodeURIComponent(conversationId)}`,
  });

  return json(req, res, 200, { ok: true });
};
