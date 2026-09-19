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
    // Logged in full for now - this is the first real visibility into
    // what actually happens to a message after Meta accepts it for
    // sending (sent/delivered/read/failed), visible in Vercel's function
    // logs for this endpoint.
    console.log('WhatsApp webhook event:', JSON.stringify(body));

    const statuses =
      body?.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses || []) || []) || [];
    for (const s of statuses) {
      if (s.status === 'failed') {
        const detail = (s.errors || [])
          .map((e) => `${e.code}: ${e.title}${e.error_data?.details ? ' — ' + e.error_data.details : ''}`)
          .join('; ');
        console.error('WhatsApp message failed to deliver:', s.id, detail);
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook parse error:', e?.message || e);
  }

  return json(req, res, 200, { ok: true });
};
