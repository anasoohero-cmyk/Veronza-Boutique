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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = req.headers.authorization || '';
  if (!supabaseUrl || !serviceKey || !/^Bearer\s+/i.test(auth))
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  let user;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return res.status(401).json({ ok: false, error: 'Invalid session' });
    user = await r.json();
  } catch (_) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
  const h = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const a = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers: h },
  );
  if (!a.ok || !(await a.json()).length)
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  const c = await fetch(
    `${supabaseUrl}/rest/v1/push_config?select=vapid_public_key&id=eq.true&limit=1`,
    { headers: h },
  );
  if (!c.ok) return res.status(500).json({ ok: false, error: 'Push configuration unavailable' });
  const row = (await c.json())[0];
  if (!row) return res.status(500).json({ ok: false, error: 'Push configuration unavailable' });
  return res.status(200).json({ ok: true, publicKey: row.vapid_public_key });
};
