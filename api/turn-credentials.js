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
    'Access-Control-Allow-Headers': 'Content-Type',
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
  const origin = allowedOrigin(req);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(200).json({ ok: true, iceServers: [] });
  }
  try {
    const cfgResp = await fetch(
      `${supabaseUrl}/rest/v1/turn_config?select=metered_domain,metered_api_key&id=eq.true&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
    if (!cfg) return res.status(200).json({ ok: true, iceServers: [] });

    const turnResp = await fetch(
      `https://${cfg.metered_domain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.metered_api_key)}`,
    );
    if (!turnResp.ok) return res.status(200).json({ ok: true, iceServers: [] });
    const iceServers = await turnResp.json();
    return res.status(200).json({ ok: true, iceServers: Array.isArray(iceServers) ? iceServers : [] });
  } catch (_) {
    // A TURN outage shouldn't break calling entirely - the caller falls
    // back to STUN-only, which still works on more permissive networks.
    return res.status(200).json({ ok: true, iceServers: [] });
  }
};
