const webpush = require('web-push');

function vapidSubject() {
  return (
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://veronza.vercel.app')
  );
}

async function unreadCountFor(supabaseUrl, headers, adminUserId) {
  const r = await fetch(
    `${supabaseUrl}/rest/v1/notifications?select=id&admin_user_id=eq.${encodeURIComponent(adminUserId)}&read_at=is.null`,
    { headers },
  );
  if (!r.ok) return 0;
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Notifies every admin: writes a `notifications` row and sends a web-push
 * to each of their registered devices, including the current unread count
 * so the service worker can set the home-screen app badge.
 */
async function notifyAdmins(supabaseUrl, serviceKey, { type, title, body, orderId, url }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  try {
    const adminResp = await fetch(`${supabaseUrl}/rest/v1/admin_users?select=user_id`, {
      headers,
    });
    if (!adminResp.ok) return;
    const admins = await adminResp.json();
    if (!admins.length) return;

    const notificationRows = admins.map((a) => ({
      admin_user_id: a.user_id,
      type,
      title,
      body,
      order_id: orderId || null,
      url: url || null,
    }));
    await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(notificationRows),
    }).catch(() => {});

    const cfgResp = await fetch(
      `${supabaseUrl}/rest/v1/push_config?select=vapid_public_key,vapid_private_key&id=eq.true&limit=1`,
      { headers },
    );
    const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
    const subsResp = await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?select=id,admin_user_id,endpoint,subscription`,
      { headers },
    );
    const subscriptions = subsResp.ok ? await subsResp.json() : [];
    if (!cfg || !subscriptions.length) return;

    webpush.setVapidDetails(vapidSubject(), cfg.vapid_public_key, cfg.vapid_private_key);

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const badgeCount = await unreadCountFor(supabaseUrl, headers, sub.admin_user_id);
          await webpush.sendNotification(
            sub.subscription,
            JSON.stringify({ title, body, url: url || '/', badgeCount }),
          );
          await fetch(
            `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`,
            {
              method: 'PATCH',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({
                last_sent_at: new Date().toISOString(),
                last_error: null,
                last_error_at: null,
              }),
            },
          ).catch(() => {});
        } catch (e) {
          const errorDetail = `${e?.statusCode || ''} ${e?.body || e?.message || e}`.slice(
            0,
            500,
          );
          console.error('Push notification failed:', errorDetail);
          await fetch(
            `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`,
            {
              method: 'PATCH',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({
                last_error: errorDetail,
                last_error_at: new Date().toISOString(),
              }),
            },
          ).catch(() => {});
          if (e?.statusCode === 404 || e?.statusCode === 410)
            await fetch(
              `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`,
              { method: 'DELETE', headers },
            ).catch(() => {});
        }
      }),
    );
  } catch (e) {
    console.error('notifyAdmins failed:', e?.message || e);
  }
}

module.exports = { notifyAdmins };
