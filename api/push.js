// Combines two related push-notification endpoints into one serverless
// function (GET = VAPID public key for subscribing, POST = save a
// subscription, DELETE = remove one). See calls.js for why these were
// merged — Vercel's Hobby plan caps a deployment at 12 serverless
// functions, and the project had crossed that limit. This is a pure
// routing change from the previous push-config.js / push-subscribe.js —
// none of the behavior below changed.
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    Vary: 'Origin',
  };
  const origin = allowedOrigin(req);
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function requireAdminUser(req, supabaseUrl, serviceKey) {
  const auth = req.headers.authorization || '';
  if (!/^Bearer\s+/i.test(auth)) return null;
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  let user;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    user = await r.json();
  } catch (_) {
    return null;
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const a = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers },
  );
  if (!a.ok || !(await a.json()).length) return null;
  return user;
}

async function handleConfig(req, res, supabaseUrl, serviceKey) {
  const user = await requireAdminUser(req, supabaseUrl, serviceKey);
  if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
  const h = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const c = await fetch(`${supabaseUrl}/rest/v1/push_config?select=vapid_public_key&id=eq.true&limit=1`, {
    headers: h,
  });
  if (!c.ok) return res.status(500).json({ ok: false, error: 'Push configuration unavailable' });
  const row = (await c.json())[0];
  if (!row) return res.status(500).json({ ok: false, error: 'Push configuration unavailable' });
  return res.status(200).json({ ok: true, publicKey: row.vapid_public_key });
}

async function handleSubscribe(req, res, supabaseUrl, serviceKey) {
  const user = await requireAdminUser(req, supabaseUrl, serviceKey);
  if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  if (req.method === 'DELETE') {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ ok: false, error: 'Endpoint required' });
    await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?admin_user_id=eq.${encodeURIComponent(user.id)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
      { method: 'DELETE', headers },
    );
    return res.status(200).json({ ok: true });
  }
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
    return res.status(400).json({ ok: false, error: 'Invalid subscription' });
  const r = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      admin_user_id: user.id,
      endpoint: sub.endpoint,
      subscription: sub,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return res.status(500).json({ ok: false, error: 'Could not save subscription' });
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    return res.status(500).json({ ok: false, error: 'Server configuration incomplete' });
  const origin = allowedOrigin(req);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'GET') return handleConfig(req, res, supabaseUrl, serviceKey);
  if (req.method === 'POST' || req.method === 'DELETE')
    return handleSubscribe(req, res, supabaseUrl, serviceKey);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
