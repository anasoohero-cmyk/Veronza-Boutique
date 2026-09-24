(() => {
  const wait = () =>
    window.veronzaSupabase ? init(window.veronzaSupabase) : setTimeout(wait, 300);
  const base64ToBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4),
      raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const ensurePush = async (client, session, verbose) => {
    try {
      if (
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        if (verbose) alert('الإشعارات غير مدعومة على هذا المتصفح أو الجهاز.');
        return;
      }
      if (Notification.permission === 'denied') {
        if (verbose)
          alert(
            'الإشعارات مرفوضة من إعدادات جهازك.\n\nلتفعيلها يدويًا على آيفون: افتح إعدادات الجهاز ← دوّر على اسم التطبيق (Veronza) ← الإشعارات ← فعّل "السماح بالإشعارات".',
          );
        return;
      }
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          if (verbose) alert('ما تم منح إذن الإشعارات.');
          return;
        }
      }
      if (Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const cfg = await fetch('/api/push', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
          .then((r) => r.json())
          .catch(() => null);
        if (!cfg?.publicKey) {
          if (verbose) alert('تعذر تجهيز إعدادات الإشعارات من السيرفر.');
          return;
        }
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToBytes(cfg.publicKey),
        });
      }
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(sub.toJSON()),
      });
      const alreadyConfirmed = localStorage.getItem('veronza-push-confirmed') === '1';
      if (verbose && r.ok && !alreadyConfirmed) {
        alert('تم تفعيل إشعارات الهاتف بنجاح ✓');
        localStorage.setItem('veronza-push-confirmed', '1');
      }
      if (verbose && !r.ok) alert('تعذر حفظ إعداد الإشعارات بالسيرفر.');
    } catch (e) {
      console.warn('Veronza push setup:', e?.message || e);
      if (verbose) alert('صار خطأ غير متوقع أثناء تفعيل الإشعارات: ' + (e?.message || e));
    }
  };
  const init = async (client) => {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) return;
    const { data: admin } = await client
      .from('admin_users')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (!admin) return;
    if (!document.getElementById('vz-notify-style')) {
      const s = document.createElement('style');
      s.id = 'vz-notify-style';
      s.textContent = `.vz-badge{position:absolute;top:-4px;right:-4px;background:#b21f2d;color:#fff;border-radius:99px;min-width:17px;height:17px;font:700 10px/17px Arial;text-align:center}.vz-panel{position:fixed;inset:0 0 0 auto;width:min(94vw,390px);background:#fff;z-index:180;box-shadow:-10px 0 35px #0002;transform:translateX(105%);transition:.25s;display:flex;flex-direction:column}.vz-panel.open{transform:none}.vz-nhead{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;padding-top:max(16px,calc(env(safe-area-inset-top) + 10px));border-bottom:1px solid #eee;background:#faf9f7}.vz-nhead h3{margin:0;font-size:17px;font-family:'Playfair Display',serif}.vz-nhead button{border:0;background:#f4f1ec;color:#111;width:34px;height:34px;border-radius:50%;font:inherit;font-size:18px;display:grid;place-items:center;flex-shrink:0}.vz-list{overflow:auto;overscroll-behavior:contain;padding:12px;flex:1}.vz-item{border:1px solid #e8e3dc;border-radius:13px;padding:12px;margin-bottom:10px;cursor:pointer}.vz-item.unread{border-color:#111;background:#faf9f7}.vz-item strong{display:block}.vz-item small{display:block;color:#777;margin-top:5px}.vz-empty{padding:30px 12px;text-align:center;color:#777}.vz-shade{position:fixed;inset:0;background:#0006;z-index:175;display:none}.vz-shade.open{display:block}@media(min-width:700px){.vz-shade.open{display:none}}`;
      document.head.appendChild(s);
    }
    const btn = document.createElement('button');
    btn.id = 'vz-notify';
    btn.className = 'icon-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'الإشعارات');
    btn.innerHTML =
      '<span class="icon-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span><span class="icon-label">الإشعارات</span>';
    (
      document.querySelector('.top-actions') || document.querySelector('.header-actions')
    )?.appendChild(btn);
    if (!btn.isConnected) return;
    const badge = document.createElement('span');
    badge.className = 'vz-badge';
    badge.hidden = true;
    btn.querySelector('.icon-circle').appendChild(badge);
    const shade = document.createElement('div');
    shade.className = 'vz-shade';
    document.body.appendChild(shade);
    const panel = document.createElement('aside');
    panel.className = 'vz-panel';
    panel.innerHTML = `<div class="vz-nhead"><h3>الإشعارات</h3><button type="button" data-nclose>×</button></div><div class="vz-list" data-nlist></div>`;
    document.body.appendChild(panel);
    const list = panel.querySelector('[data-nlist]');
    const fmt = (d) =>
      new Date(d).toLocaleString('ar-LY', { dateStyle: 'medium', timeStyle: 'short' });
    let currentRows = [];
    const render = (rows) => {
      currentRows = rows;
      badge.hidden = !rows.some((x) => !x.read_at);
      const unread = rows.filter((x) => !x.read_at).length;
      badge.textContent = unread > 99 ? '99+' : unread;
      if ('setAppBadge' in navigator) {
        (unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});
      }
      list.innerHTML = rows.length
        ? rows
            .map(
              (x) =>
                `<div class="vz-item ${x.read_at ? '' : 'unread'}" data-id="${x.id}"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.body)}</span><small>${fmt(x.created_at)}</small></div>`,
            )
            .join('')
        : '<div class="vz-empty">ما فيش إشعارات حتى الآن.</div>';
      list.querySelectorAll('[data-id]').forEach(
        (el) =>
          (el.onclick = async () => {
            const row = currentRows.find((x) => String(x.id) === el.dataset.id);
            await client
              .from('notifications')
              .update({ read_at: new Date().toISOString() })
              .eq('id', el.dataset.id)
              .eq('admin_user_id', session.user.id);
            // Older rows (sent before the url column existed) fall back to
            // the order page when there's an order_id to work with.
            const dest = row?.url || (row?.order_id ? `/admin.html?order=${row.order_id}` : null);
            if (dest) location.href = dest;
            else load();
          }),
      );
    };
    const escapeHtml = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
      );
    let hasLoadedOnce = false;
    const fetchNotifications = () =>
      client
        .from('notifications')
        .select('id,title,body,read_at,created_at,order_id,url')
        .eq('admin_user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100);
    const renderLoadError = () => {
      // Only replace the list with an error state on the very first load —
      // a background refresh (e.g. triggered by the realtime channel) that
      // fails transiently shouldn't wipe out a list that already loaded fine.
      if (hasLoadedOnce) return;
      list.innerHTML =
        '<div class="vz-empty">تعذر تحميل الإشعارات.<br><a href="#" data-retry>إعادة المحاولة</a></div>';
      list.querySelector('[data-retry]')?.addEventListener('click', (e) => {
        e.preventDefault();
        load();
      });
    };
    const load = async () => {
      let { data, error } = await fetchNotifications();
      if (error) {
        // A single quick retry absorbs most transient network blips before
        // falling back to a visible error state instead of silently
        // rendering "no notifications" for a fetch that actually failed.
        await new Promise((r) => setTimeout(r, 1500));
        ({ data, error } = await fetchNotifications());
      }
      if (error) {
        console.warn('Veronza notifications load failed:', error.message || error);
        renderLoadError();
        return;
      }
      hasLoadedOnce = true;
      render(data || []);
    };
    const open = () => {
      panel.classList.add('open');
      shade.classList.add('open');
      document.body.style.overflow = 'hidden';
      load();
      // Was verbose (true) - fired an alert() dialog on the push-subscription
      // refresh EVERY time this panel opened, freezing the whole page (alert
      // is a blocking, synchronous dialog) on any transient failure - which
      // could easily swallow the exact tap meant to open an incoming call's
      // notification. Silent here; window.veronzaEnsurePush (a dedicated,
      // explicit "enable notifications" action elsewhere) still asks loudly.
      ensurePush(client, session, false);
    };
    const close = () => {
      panel.classList.remove('open');
      shade.classList.remove('open');
      document.body.style.overflow = '';
    };
    btn.onclick = open;
    shade.onclick = close;
    panel.querySelector('[data-nclose]').onclick = close;
    window.veronzaEnsurePush = () => ensurePush(client, session, true);
    let globalCall = null,
      globalCallUI = null,
      globalCallConversationId = null;
    // A call ringing while the admin is anywhere else in the panel (not the
    // specific chat thread) - answered here, using the same VeronzaCall/
    // mountUI machinery admin-chat.html and the floating widget already use.
    // Skipped if that same conversation already has its own listener open
    // (registered in window.veronzaActiveCallConversationIds), so we never
    // double-subscribe to the same signaling channel.
    const handleIncomingCallRow = (row) => {
      if (row?.type !== 'call' || !window.VeronzaCall) return;
      const id = (row.url || '').match(/[?&]c=([^&]+)/)?.[1];
      if (!id || window.veronzaActiveCallConversationIds?.has(id)) return;
      if (globalCallConversationId === id) return;
      globalCallUI?.destroy();
      globalCall?.destroy();
      globalCallConversationId = id;
      globalCall = new window.VeronzaCall(client, id);
      // Answering here (via the notification, not a specific open
      // conversation) never logged the call's outcome to the chat at all -
      // neither a successful call's duration nor a failed connection - since
      // onCallEnded below only ever reset local state. This is very likely
      // the exact path used for calls answered by tapping the notification,
      // which is why they never showed up in the thread.
      const logCallMessage = async (text) => {
        const { error } = await client
          .from('chat_messages')
          .insert({ conversation_id: id, sender: 'admin', body: text });
        if (error) return;
        await client
          .from('chat_conversations')
          .update({ customer_unread: true, last_message_at: new Date().toISOString() })
          .eq('id', id);
      };
      globalCallUI = window.VeronzaCall.mountUI(globalCall, {
        calleeLabel: (row.body || '').replace(/ يتصل بك الآن من الشات.*$/, '') || 'الزبون',
        onCallFailed: () => logCallMessage('📞 مكالمة لم تكتمل — تعذر إكمال الاتصال'),
      });
      const cleanup = () => {
        globalCallConversationId = null;
      };
      globalCall.onCallEnded = (durationSec) => {
        const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
        const ss = String(durationSec % 60).padStart(2, '0');
        logCallMessage(`📞 مكالمة صوتية — المدة: ${mm}:${ss}`);
        cleanup();
      };
      const origDestroy = globalCallUI.destroy.bind(globalCallUI);
      globalCallUI.destroy = () => {
        cleanup();
        origDestroy();
      };
    };
    client
      .channel('veronza-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `admin_user_id=eq.${session.user.id}`,
        },
        (payload) => {
          load();
          handleIncomingCallRow(payload.new);
          try {
            new Audio(
              'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
            ).play();
          } catch (_) {}
        },
      )
      .subscribe();
    load();
    ensurePush(client, session);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') ensurePush(client, session);
    });
    setInterval(() => ensurePush(client, session), 6 * 60 * 60 * 1000);
  };
  wait();
})();
