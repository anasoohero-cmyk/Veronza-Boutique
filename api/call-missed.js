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
  // Only log a missed call for a conversation that actually exists — same
  // guard as call-notify, so a stranger guessing random ids can't spam
  // fake missed-call entries into the admin's chat log.
  const convResp = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?select=id,missed_calls_count&id=eq.${encodeURIComponent(conversationId)}&limit=1`,
    { headers },
  );
  if (!convResp.ok) return json(req, res, 502, { error: 'Lookup failed' });
  const conversation = (await convResp.json())[0];
  if (!conversation) return json(req, res, 404, { error: 'Conversation not found' });

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      conversation_id: conversationId,
      sender: 'customer',
      body: '📞 مكالمة فائتة — لم يتم الرد عليها',
    }),
  });

  await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${encodeURIComponent(conversationId)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        admin_unread: true,
        last_message_at: new Date().toISOString(),
        missed_calls_count: (conversation.missed_calls_count || 0) + 1,
      }),
    },
  );

  return json(req, res, 200, { ok: true });
};
