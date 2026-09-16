const webpush = require('web-push');
const crypto = require('crypto');

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

async function sbFetch(supabaseUrl, serviceKey, path, options = {}) {
  const r = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data };
}

function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

async function notifyAdmins(supabaseUrl, serviceKey, conversation, preview) {
  try {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };
    const adminResp = await fetch(`${supabaseUrl}/rest/v1/admin_users?select=user_id`, { headers });
    if (!adminResp.ok) return;
    const admins = await adminResp.json();
    const title = 'رسالة جديدة في الشات';
    const body = `${conversation.customer_name || 'زائر'}: ${preview}`.slice(0, 180);
    const notificationRows = admins.map((a) => ({
      admin_user_id: a.user_id,
      type: 'chat',
      title,
      body,
      order_id: null,
    }));
    if (notificationRows.length) {
      await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(notificationRows),
      }).catch(() => {});
    }
    const cfgResp = await fetch(
      `${supabaseUrl}/rest/v1/push_config?select=vapid_public_key,vapid_private_key&id=eq.true&limit=1`,
      { headers },
    );
    const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
    const subsResp = await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?select=id,endpoint,subscription`,
      { headers },
    );
    const subscriptions = subsResp.ok ? await subsResp.json() : [];
    if (cfg && subscriptions.length) {
      webpush.setVapidDetails(
        'mailto:veronza@localhost',
        cfg.vapid_public_key,
        cfg.vapid_private_key,
      );
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              sub.subscription,
              JSON.stringify({ title, body, url: '/admin-chat.html' }),
            );
          } catch (e) {
            if (e?.statusCode === 404 || e?.statusCode === 410)
              await fetch(
                `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`,
                { method: 'DELETE', headers },
              ).catch(() => {});
          }
        }),
      );
    }
  } catch (e) {
    console.error('Chat admin notify failed:', e?.message || e);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    return json(req, res, 500, { ok: false, error: 'Server configuration incomplete' });

  if (req.method === 'GET') {
    const q = req.query || {};
    const conversationId = String(q.conversation_id || '').trim();
    const guestToken = String(q.guest_token || '').trim();
    const since = String(q.since || '').trim();
    if (!isUuid(conversationId) || !isUuid(guestToken))
      return json(req, res, 400, { ok: false, error: 'Invalid identifiers' });

    const convResp = await sbFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/chat_conversations?select=id,status,guest_token,admin_unread&id=eq.${encodeURIComponent(conversationId)}&limit=1`,
    );
    const conversation = convResp.ok && Array.isArray(convResp.data) ? convResp.data[0] : null;
    if (!conversation || conversation.guest_token !== guestToken)
      return json(req, res, 404, { ok: false, error: 'Conversation not found' });

    let messagesPath = `/rest/v1/chat_messages?select=id,sender,body,created_at&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc`;
    if (since) messagesPath += `&created_at=gt.${encodeURIComponent(since)}`;
    const msgResp = await sbFetch(supabaseUrl, serviceKey, messagesPath);
    if (!msgResp.ok) return json(req, res, 502, { ok: false, error: 'Could not load messages' });

    if (!since) {
      await sbFetch(
        supabaseUrl,
        serviceKey,
        `/rest/v1/chat_conversations?id=eq.${encodeURIComponent(conversationId)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ customer_unread: false }),
        },
      );
    }

    return json(req, res, 200, {
      ok: true,
      status: conversation.status,
      messages: msgResp.data || [],
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST');
    return json(req, res, 405, { ok: false, error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(req, res, 400, { ok: false, error: 'Invalid JSON' });
    }
  }
  const action = String(body.action || '').trim();

  if (action === 'start') {
    const name = String(body.customer_name || '')
      .trim()
      .slice(0, 120);
    const phone = String(body.customer_phone || '')
      .trim()
      .slice(0, 40);
    const guestToken = crypto.randomUUID();
    const insertResp = await sbFetch(supabaseUrl, serviceKey, `/rest/v1/chat_conversations`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        guest_token: guestToken,
        customer_name: name || null,
        customer_phone: phone || null,
      }),
    });
    if (!insertResp.ok)
      return json(req, res, 502, { ok: false, error: 'Could not start conversation' });
    const conversation = Array.isArray(insertResp.data) ? insertResp.data[0] : insertResp.data;
    return json(req, res, 200, {
      ok: true,
      conversation_id: conversation.id,
      guest_token: guestToken,
    });
  }

  if (action === 'send') {
    const conversationId = String(body.conversation_id || '').trim();
    const guestToken = String(body.guest_token || '').trim();
    const text = String(body.body || '')
      .trim()
      .slice(0, 2000);
    if (!isUuid(conversationId) || !isUuid(guestToken))
      return json(req, res, 400, { ok: false, error: 'Invalid identifiers' });
    if (!text) return json(req, res, 400, { ok: false, error: 'Message body required' });

    const convResp = await sbFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/chat_conversations?select=id,guest_token,customer_name&id=eq.${encodeURIComponent(conversationId)}&limit=1`,
    );
    const conversation = convResp.ok && Array.isArray(convResp.data) ? convResp.data[0] : null;
    if (!conversation || conversation.guest_token !== guestToken)
      return json(req, res, 404, { ok: false, error: 'Conversation not found' });

    const updates = {
      admin_unread: true,
      last_message_at: new Date().toISOString(),
      status: 'open',
    };
    if (body.customer_name && !conversation.customer_name)
      updates.customer_name = String(body.customer_name).trim().slice(0, 120);
    if (body.customer_phone)
      updates.customer_phone = String(body.customer_phone).trim().slice(0, 40);

    const insertMsg = await sbFetch(supabaseUrl, serviceKey, `/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ conversation_id: conversationId, sender: 'customer', body: text }),
    });
    if (!insertMsg.ok) return json(req, res, 502, { ok: false, error: 'Could not send message' });

    await sbFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/chat_conversations?id=eq.${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      },
    );

    await notifyAdmins(
      supabaseUrl,
      serviceKey,
      { customer_name: updates.customer_name || conversation.customer_name },
      text,
    );

    const message = Array.isArray(insertMsg.data) ? insertMsg.data[0] : insertMsg.data;
    return json(req, res, 200, { ok: true, message });
  }

  return json(req, res, 400, { ok: false, error: 'Unknown action' });
};
