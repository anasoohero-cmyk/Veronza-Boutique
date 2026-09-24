// Combines three small, related call-signaling endpoints into one
// serverless function (GET = TURN credentials, POST ?type=notify = an
// in-site call just started, POST ?type=missed = one rang out unanswered).
// Vercel's Hobby plan caps a deployment at 12 serverless functions - each
// api/*.js file used to count as its own, and the project had crossed that
// limit, so every production deploy had been silently failing since one
// too many files were added. Merging these (previously
// turn-credentials.js, call-notify.js, call-missed.js) is a pure routing
// change - none of the three behaviors below changed.
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function handleTurnCredentials(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SERVICE_KEY) return json(req, res, 200, { ok: true, iceServers: [] });
  try {
    const cfgResp = await fetch(
      `${SUPABASE_URL}/rest/v1/turn_config?select=metered_domain,metered_api_key&id=eq.true&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
    if (!cfg) return json(req, res, 200, { ok: true, iceServers: [] });

    const turnResp = await fetch(
      `https://${cfg.metered_domain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.metered_api_key)}`,
    );
    if (!turnResp.ok) return json(req, res, 200, { ok: true, iceServers: [] });
    const iceServers = await turnResp.json();
    return json(req, res, 200, { ok: true, iceServers: Array.isArray(iceServers) ? iceServers : [] });
  } catch (_) {
    // A TURN outage shouldn't break calling entirely - the caller falls
    // back to STUN-only, which still works on more permissive networks.
    return json(req, res, 200, { ok: true, iceServers: [] });
  }
}

async function readJsonBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

async function handleCallNotify(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });
  const body = await readJsonBody(req);
  if (body === null) return json(req, res, 400, { error: 'Invalid JSON' });
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
}

// Shared by handleCallMissed and handleCallFailed - a call that rang out
// unanswered and one that was answered but never actually connected (e.g.
// no working TURN relay) both need the same "record this so the admin
// sees it happened" treatment: a system message in the thread, marking it
// unread, and bumping the counter the admin's missed-calls badge reads.
async function logCallEvent(conversationId, messageBody, headers) {
  const convResp = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?select=id,missed_calls_count&id=eq.${encodeURIComponent(conversationId)}&limit=1`,
    { headers },
  );
  if (!convResp.ok) return { ok: false, status: 502, error: 'Lookup failed' };
  const conversation = (await convResp.json())[0];
  if (!conversation) return { ok: false, status: 404, error: 'Conversation not found' };

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ conversation_id: conversationId, sender: 'customer', body: messageBody }),
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
  return { ok: true };
}

async function handleCallMissed(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });
  const body = await readJsonBody(req);
  if (body === null) return json(req, res, 400, { error: 'Invalid JSON' });
  const conversationId = String(body.conversation_id || '').trim();
  if (!conversationId) return json(req, res, 400, { error: 'conversation_id required' });

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  // Only log for a conversation that actually exists — a stranger guessing
  // random ids should not be able to spam fake entries into the admin's chat.
  const result = await logCallEvent(conversationId, '📞 مكالمة فائتة — لم يتم الرد عليها', headers);
  if (!result.ok) return json(req, res, result.status, { error: result.error });
  return json(req, res, 200, { ok: true });
}

// A call that WAS answered (both sides exchanged signaling) but whose
// audio connection never actually established - e.g. no working TURN
// relay for two devices both on cellular data - used to leave zero trace
// anywhere: it isn't "missed" (someone did answer) so the existing missed-
// call logging never covered it, and it never reaches the connected state
// onCallEnded's duration-logging requires either. Reported live: an
// answered-but-failed call had no record in the chat at all.
async function handleCallFailed(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(req, res, 500, { error: 'Server configuration is incomplete' });
  const body = await readJsonBody(req);
  if (body === null) return json(req, res, 400, { error: 'Invalid JSON' });
  const conversationId = String(body.conversation_id || '').trim();
  if (!conversationId) return json(req, res, 400, { error: 'conversation_id required' });

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const result = await logCallEvent(
    conversationId,
    '📞 مكالمة لم تكتمل — تعذر إكمال الاتصال',
    headers,
  );
  if (!result.ok) return json(req, res, result.status, { error: result.error });
  return json(req, res, 200, { ok: true });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  const type = new URL(req.url, 'http://veronza.local').searchParams.get('type');
  if (req.method === 'GET') return handleTurnCredentials(req, res);
  if (req.method === 'POST' && type === 'notify') return handleCallNotify(req, res);
  if (req.method === 'POST' && type === 'missed') return handleCallMissed(req, res);
  if (req.method === 'POST' && type === 'failed') return handleCallFailed(req, res);
  res.setHeader('Allow', 'GET, POST');
  return json(req, res, 405, { error: 'Method not allowed' });
};
