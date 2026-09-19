// Meta calls this URL two ways:
// - GET: the one-time verification handshake when you save the Callback
//   URL/Verify token in the Meta dashboard - it must echo back
//   hub.challenge if hub.verify_token matches our own secret.
// - POST: every actual event afterward (message delivery/read/failed
//   status updates, and incoming customer messages if that's ever
//   subscribed to). Meta requires a fast 200 regardless of what we do
//   with the payload, or it will retry and eventually disable the
//   subscription.
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

function json(req, res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const q = req.query || {};
    // Temporary one-off action: links this app as the webhook receiver for a
    // WABA (POST /{waba-id}/subscribed_apps) - a step separate from the
    // Callback URL verification above, and easy to miss.
    if (q.action === 'link_waba') {
      if (!VERIFY_TOKEN || q.secret !== VERIFY_TOKEN)
        return json(req, res, 403, { ok: false, error: 'Bad secret' });
      const metaToken = process.env.META_ACCESS_TOKEN;
      const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
      if (!metaToken || !phoneNumberId)
        return json(req, res, 400, { ok: false, error: 'Missing META_ACCESS_TOKEN or META_PHONE_NUMBER_ID' });
      let wabaId = q.waba_id;
      let lookup = null;
      if (!wabaId) {
        // Phone-number node doesn't expose its parent WABA directly - the
        // access token's own granular scopes do (the WABA id it was granted
        // whatsapp_business_management on).
        const lr = await fetch(
          `https://graph.facebook.com/v23.0/debug_token?input_token=${encodeURIComponent(metaToken)}&access_token=${encodeURIComponent(metaToken)}`,
        );
        lookup = await lr.json().catch(() => ({}));
        const scopes = lookup?.data?.granular_scopes || [];
        wabaId = scopes.find((s) => s.scope === 'whatsapp_business_management')?.target_ids?.[0];
        if (!wabaId) return json(req, res, 200, { ok: false, step: 'lookup', lookup });
      }
      const r = await fetch(
        `https://graph.facebook.com/v23.0/${encodeURIComponent(wabaId)}/subscribed_apps`,
        { method: 'POST', headers: { Authorization: `Bearer ${metaToken}` } },
      );
      const data = await r.json().catch(() => ({}));
      return json(req, res, r.status, { ok: r.ok, wabaId, lookup, data });
    }
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end(String(challenge || ''));
    }
    return json(req, res, 403, { ok: false, error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(req, res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const statuses =
      body?.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses || []) || []) || [];
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (statuses.length && supabaseUrl && serviceKey) {
      const rows = statuses.map((s) => {
        const err = (s.errors || [])[0];
        return {
          message_id: s.id || null,
          recipient: s.recipient_id || null,
          status: s.status || null,
          error_code: err?.code ?? null,
          error_title: err?.title || null,
          error_detail: err?.error_data?.details || null,
          raw: s,
        };
      });
      await fetch(`${supabaseUrl}/rest/v1/whatsapp_delivery_events`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rows),
      }).catch((e) => console.error('Failed to persist WhatsApp delivery event:', e?.message || e));
    }
  } catch (e) {
    console.error('WhatsApp webhook parse error:', e?.message || e);
  }

  return json(req, res, 200, { ok: true });
};
