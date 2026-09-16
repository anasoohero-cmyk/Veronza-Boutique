(() => {
  const wait = () =>
    window.veronzaSupabase ? init(window.veronzaSupabase) : setTimeout(wait, 300);
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
    );
  const fmtTime = (d) =>
    new Date(d).toLocaleString('ar-LY', { dateStyle: 'short', timeStyle: 'short' });
  const init = async (client) => {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) return;
    const { data: admin } = await client
      .from('admin_users')
      .select('user_id,role,permissions')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (!admin) return;
    const canViewChat = admin.role === 'owner' || !!admin.permissions?.chat?.view;
    const canEditChat = admin.role === 'owner' || !!admin.permissions?.chat?.edit;
    if (!canViewChat) return;

    if (!document.getElementById('vz-chatw-style')) {
      const s = document.createElement('style');
      s.id = 'vz-chatw-style';
      s.textContent = `
        .vz-chatw-badge{position:absolute;top:-4px;right:-4px;background:#b21f2d;color:#fff;border-radius:99px;min-width:17px;height:17px;font:700 10px/17px Arial;text-align:center}
        .vz-chatw-panel{position:fixed;inset:0 0 0 auto;width:min(94vw,400px);background:#fff;z-index:180;box-shadow:-10px 0 35px #0002;transform:translateX(105%);transition:.25s;display:flex;flex-direction:column}
        .vz-chatw-panel.open{transform:none}
        .vz-chatw-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;padding-top:max(16px,calc(env(safe-area-inset-top) + 10px));border-bottom:1px solid #eee;background:#faf9f7}
        .vz-chatw-head h3{margin:0;font-size:16px;font-family:'Playfair Display',serif}
        .vz-chatw-head button{border:0;background:#f4f1ec;color:#111;width:34px;height:34px;border-radius:50%;font:inherit;font-size:18px;display:grid;place-items:center;flex-shrink:0}
        .vz-chatw-back{display:none}
        .vz-chatw-panel.thread .vz-chatw-back{display:grid}
        .vz-chatw-panel.thread .vz-chatw-close-list{display:none}
        .vz-chatw-list{overflow:auto;overscroll-behavior:contain;flex:1}
        .vz-chatw-row{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #eee;cursor:pointer;position:relative}
        .vz-chatw-row:hover{background:#faf9f7}
        .vz-chatw-avatar{width:38px;height:38px;border-radius:50%;background:#f4f1ec;display:grid;place-items:center;font-weight:800;flex-shrink:0}
        .vz-chatw-rowinfo{flex:1;min-width:0}
        .vz-chatw-name{font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .vz-chatw-preview{font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
        .vz-chatw-time{font-size:9px;color:#999;flex-shrink:0}
        .vz-chatw-unread{position:absolute;top:13px;left:14px;width:9px;height:9px;border-radius:50%;background:#b21f2d}
        .vz-chatw-empty{padding:40px 20px;text-align:center;color:#888;font-size:13px}
        .vz-chatw-thread{display:none;flex-direction:column;flex:1;min-height:0}
        .vz-chatw-panel.thread .vz-chatw-list{display:none}
        .vz-chatw-panel.thread .vz-chatw-thread{display:flex}
        .vz-chatw-messages{flex:1;overflow:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:10px}
        .vz-chatw-msg{max-width:78%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.6;word-break:break-word}
        .vz-chatw-msg.customer{align-self:flex-start;background:#f2eee6;color:#111;border-bottom-left-radius:4px}
        .vz-chatw-msg.admin{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}
        .vz-chatw-msg time{display:block;font-size:9px;opacity:.6;margin-top:4px}
        .vz-chatw-reply{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee}
        .vz-chatw-reply input{flex:1;border:1px solid #ddd8d0;border-radius:99px;padding:11px 15px;font:inherit;font-size:13px}
        .vz-chatw-reply button{border:0;background:#111;color:#fff;border-radius:99px;padding:11px 18px;font:inherit;font-weight:700}
        .vz-chatw-shade{position:fixed;inset:0;background:#0006;z-index:175;display:none}
        .vz-chatw-shade.open{display:block}
        @media(min-width:700px){.vz-chatw-shade.open{display:none}}
      `;
      document.head.appendChild(s);
    }

    const btn = document.createElement('button');
    btn.id = 'vz-chatw-btn';
    btn.className = 'icon-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'الشات');
    btn.innerHTML =
      '<span class="icon-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span><span class="icon-label">الشات</span>';
    (
      document.querySelector('.top-actions') || document.querySelector('.header-actions')
    )?.appendChild(btn);
    if (!btn.isConnected) return;
    const badge = document.createElement('span');
    badge.className = 'vz-chatw-badge';
    badge.hidden = true;
    btn.querySelector('.icon-circle').appendChild(badge);

    const shade = document.createElement('div');
    shade.className = 'vz-chatw-shade';
    document.body.appendChild(shade);
    const panel = document.createElement('aside');
    panel.className = 'vz-chatw-panel';
    panel.innerHTML = `
      <div class="vz-chatw-head">
        <button type="button" class="vz-chatw-back" data-back aria-label="رجوع">→</button>
        <h3 data-title>المحادثات</h3>
        <button type="button" class="vz-chatw-call" data-call aria-label="مكالمة صوتية" hidden>📞</button>
        <button type="button" class="vz-chatw-close-list" data-close aria-label="إغلاق">×</button>
      </div>
      <div class="vz-chatw-list" data-list></div>
      <div class="vz-chatw-thread">
        <div class="vz-chatw-messages" data-messages></div>
        <form class="vz-chatw-reply" data-reply>
          <input type="text" data-reply-input placeholder="اكتب ردك..." autocomplete="off" required>
          <button type="submit">إرسال</button>
        </form>
      </div>
    `;
    document.body.appendChild(panel);

    const listEl = panel.querySelector('[data-list]');
    const messagesEl = panel.querySelector('[data-messages]');
    const titleEl = panel.querySelector('[data-title]');
    const replyForm = panel.querySelector('[data-reply]');
    const replyInput = panel.querySelector('[data-reply-input]');
    if (!canEditChat) {
      replyInput.disabled = true;
      replyInput.placeholder = 'للعرض فقط — لا تملك صلاحية الرد';
      replyForm.querySelector('button')?.setAttribute('disabled', 'true');
    }

    let conversations = [],
      activeId = null,
      activeMessages = [],
      activeCall = null,
      activeCallUI = null;
    const callBtn = panel.querySelector('[data-call]');
    const teardownCall = () => {
      activeCallUI?.destroy();
      activeCall?.destroy();
      activeCall = null;
      activeCallUI = null;
      callBtn.hidden = true;
    };

    const initials = (name) => {
      const n = (name || '؟').trim();
      return n ? n[0] : '؟';
    };

    const renderList = () => {
      const unreadCount = conversations.filter((c) => c.admin_unread).length;
      badge.hidden = !unreadCount;
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      if (!conversations.length) {
        listEl.innerHTML = '<div class="vz-chatw-empty">ما فيه محادثات حتى الآن.</div>';
        return;
      }
      listEl.innerHTML = conversations
        .map(
          (c) =>
            `<div class="vz-chatw-row" data-id="${c.id}">${c.admin_unread ? '<span class="vz-chatw-unread"></span>' : ''}<div class="vz-chatw-avatar">${esc(initials(c.customer_name))}</div><div class="vz-chatw-rowinfo"><div class="vz-chatw-name">${esc(c.customer_name || 'زائر')}${c.status === 'closed' ? ' · منتهية' : ''}</div><div class="vz-chatw-preview">${esc(c.last_message_preview || '')}</div></div><div class="vz-chatw-time">${fmtTime(c.last_message_at)}</div></div>`,
        )
        .join('');
      listEl
        .querySelectorAll('[data-id]')
        .forEach((el) => (el.onclick = () => openThread(el.dataset.id)));
    };

    const loadConversations = async () => {
      const { data, error } = await client
        .from('chat_conversations')
        .select('id,customer_name,customer_phone,status,admin_unread,last_message_at')
        .order('last_message_at', { ascending: false })
        .limit(200);
      if (error) return;
      const withPreview = await Promise.all(
        (data || []).map(async (c) => {
          const { data: last } = await client
            .from('chat_messages')
            .select('body,sender')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return {
            ...c,
            last_message_preview: last ? (last.sender === 'admin' ? 'أنت: ' : '') + last.body : '',
          };
        }),
      );
      conversations = withPreview;
      renderList();
    };

    const renderMessages = () => {
      messagesEl.innerHTML =
        activeMessages
          .map(
            (m) =>
              `<div class="vz-chatw-msg ${m.sender}">${esc(m.body)}<time>${fmtTime(m.created_at)}</time></div>`,
          )
          .join('') || '<div class="vz-chatw-empty">ما فيه رسائل حتى الآن.</div>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    const openThread = async (id) => {
      activeId = id;
      panel.classList.add('thread');
      const conv = conversations.find((c) => c.id === id);
      titleEl.textContent = conv?.customer_name || 'زائر';
      const { data, error } = await client
        .from('chat_messages')
        .select('id,sender,body,created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      if (!error) {
        activeMessages = data || [];
        renderMessages();
      }
      if (conv && conv.admin_unread) {
        await client.from('chat_conversations').update({ admin_unread: false }).eq('id', id);
        conv.admin_unread = false;
        renderList();
      }
      teardownCall();
      if (canEditChat && window.VeronzaCall) {
        activeCall = new window.VeronzaCall(client, id);
        activeCallUI = window.VeronzaCall.mountUI(activeCall, {
          calleeLabel: conv?.customer_name || 'الزبون',
        });
        callBtn.hidden = false;
        callBtn.onclick = () => activeCall.startCall();
      }
      setTimeout(() => replyInput.focus(), 200);
    };

    const backToList = () => {
      activeId = null;
      teardownCall();
      panel.classList.remove('thread');
      titleEl.textContent = 'المحادثات';
    };

    replyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = replyInput.value.trim();
      if (!text || !activeId) return;
      replyInput.disabled = true;
      const { data, error } = await client
        .from('chat_messages')
        .insert({ conversation_id: activeId, sender: 'admin', body: text })
        .select()
        .single();
      if (!error) {
        await client
          .from('chat_conversations')
          .update({
            customer_unread: true,
            last_message_at: new Date().toISOString(),
            status: 'open',
          })
          .eq('id', activeId);
        activeMessages.push(data);
        renderMessages();
        loadConversations();
      }
      replyInput.value = '';
      replyInput.disabled = false;
      replyInput.focus();
    });

    panel.querySelector('[data-back]').onclick = backToList;
    const open = () => {
      panel.classList.add('open');
      shade.classList.add('open');
      window.syncBodyScrollLock?.();
      loadConversations();
      window.veronzaEnsurePush?.();
    };
    const close = () => {
      panel.classList.remove('open');
      shade.classList.remove('open');
      window.syncBodyScrollLock?.();
      backToList();
    };
    btn.onclick = open;
    window.veronzaOpenAdminChatWidget = open;
    shade.onclick = close;
    panel.querySelector('[data-close]').onclick = close;

    client
      .channel('veronza-admin-chat-widget')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new;
          if (msg.conversation_id === activeId && msg.sender === 'customer') {
            if (!activeMessages.some((m) => m.id === msg.id)) {
              activeMessages.push(msg);
              renderMessages();
            }
            client.from('chat_conversations').update({ admin_unread: false }).eq('id', activeId);
          }
          loadConversations();
          if (msg.sender === 'customer') {
            try {
              new Audio(
                'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
              ).play();
            } catch (_) {}
          }
        },
      )
      .subscribe();

    loadConversations();
  };
  wait();
})();
