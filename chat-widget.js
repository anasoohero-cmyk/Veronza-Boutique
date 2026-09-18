(() => {
  const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
  const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY) || null;
  const STORE_PHONE = '+218944000974';
  const STORAGE_KEY = 'veronza-chat-session';
  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (_) {
    session = null;
  }
  let panelOpen = false,
    pollTimer = null,
    idleTimer = null,
    lastMessageAt = null,
    sending = false,
    unreadCount = 0,
    seenIds = new Set();

  function saveSession(s) {
    session = s;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (_) {}
  }
  function esc(v) {
    return String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
    );
  }
  function fmtTime(d) {
    return new Date(d).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
  }

  if (!document.getElementById('vz-chat-style')) {
    const s = document.createElement('style');
    s.id = 'vz-chat-style';
    s.textContent = `
      .vz-chat-badge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#b21f2d;color:#fff;font-size:9px;font-weight:700;margin-inline-start:6px;vertical-align:middle}
      .chat-header-btn{position:relative}
      .chat-header-btn .vz-chat-badge{position:absolute;top:1px;right:2px;margin:0}
      .vz-chat-panel{position:fixed;left:50%;bottom:0;transform:translate(-50%,16px);opacity:0;pointer-events:none;width:min(100%,400px);height:78vh;max-height:78vh;background:#fff;z-index:95;display:flex;flex-direction:column;border-radius:22px 22px 0 0;box-shadow:0 -15px 45px rgba(0,0,0,.22);transition:transform .22s ease,opacity .22s ease;overflow:hidden}
      .vz-chat-panel.open{transform:translate(-50%,0);opacity:1;pointer-events:auto}
      .vz-chat-head{display:flex;align-items:center;gap:10px;padding:16px 18px;padding-top:max(16px,calc(env(safe-area-inset-top) + 8px));border-bottom:1px solid #eee;background:#111;color:#fff}
      .vz-chat-avatar{width:36px;height:36px;border-radius:50%;background:var(--gold,#b58a3b);display:grid;place-items:center;flex-shrink:0;font-family:'Playfair Display',serif;font-weight:700;font-size:15px}
      .vz-chat-head-info{flex:1;min-width:0}
      .vz-chat-head strong{font-family:'Playfair Display',serif;font-size:15px;display:block}
      .vz-chat-head small{display:flex;align-items:center;gap:5px;color:#c9c2b4;font-size:11px;margin-top:2px}
      .vz-chat-online-dot{width:7px;height:7px;border-radius:50%;background:#3ecf6a;display:inline-block;flex-shrink:0}
      .vz-chat-close{border:0;background:rgba(255,255,255,.12);color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;flex-shrink:0}
      .vz-chat-call{border:0;background:rgba(255,255,255,.12);color:#fff;width:32px;height:32px;border-radius:50%;font-size:15px;flex-shrink:0}
      .vz-chat-body{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
      .vz-chat-msg{max-width:78%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.6;word-break:break-word}
      .vz-chat-msg.customer{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}
      .vz-chat-msg.admin{align-self:flex-start;background:#f2eee6;color:#111;border-bottom-left-radius:4px}
      .vz-chat-msg time{display:block;font-size:9px;opacity:.6;margin-top:4px}
      .vz-chat-welcome{text-align:center;color:#888;font-size:12px;padding:20px}
      .vz-chat-name-row{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #eee;background:#faf9f7}
      .vz-chat-name-row input{flex:1;border:1px solid #ddd8d0;border-radius:10px;padding:9px 12px;font:inherit;font-size:12px}
      .vz-chat-foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee}
      .vz-chat-foot input{flex:1;border:1px solid #ddd8d0;border-radius:99px;padding:11px 16px;font:inherit;font-size:13px}
      .vz-chat-foot button{border:0;background:#111;color:#fff;border-radius:99px;padding:11px 18px;font:inherit;font-weight:700}
      .vz-chat-foot button:disabled{opacity:.5}
      @media(min-width:700px){
        .vz-chat-panel{left:auto;right:24px;bottom:24px;transform:translateY(16px);width:380px;max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 110px));max-height:min(600px,calc(100vh - 110px));border-radius:20px}
        .vz-chat-panel.open{transform:translateY(0)}
      }
    `;
    document.head.appendChild(s);
  }

  const chatTriggers = Array.from(document.querySelectorAll('[data-chat-open]'));
  if (!chatTriggers.length) return;

  const panel = document.createElement('div');
  panel.className = 'vz-chat-panel';
  panel.innerHTML = `
    <div class="vz-chat-head"><span class="vz-chat-avatar">V</span><div class="vz-chat-head-info"><strong>تواصل مع Veronza</strong><small><span class="vz-chat-online-dot"></span>عادة نرد خلال دقائق</small></div><button type="button" class="vz-chat-call" data-call aria-label="مكالمة صوتية" hidden>📞</button><button type="button" class="vz-chat-close" aria-label="إغلاق">×</button></div>
    <div class="vz-chat-name-row" data-name-row hidden><input type="text" data-name-input placeholder="اسمك (اختياري)"></div>
    <div class="vz-chat-body" data-body><div class="vz-chat-welcome">أهلاً 👋 اكتب لنا أي سؤال عن المنتجات أو الطلب وبنرد عليك بأقرب وقت.</div></div>
    <form class="vz-chat-foot" data-form><input type="text" data-input placeholder="اكتب رسالتك..." autocomplete="off" required><button type="submit">إرسال</button></form>
  `;
  document.body.appendChild(panel);

  const bodyEl = panel.querySelector('[data-body]');
  const formEl = panel.querySelector('[data-form]');
  const inputEl = panel.querySelector('[data-input]');
  const nameRow = panel.querySelector('[data-name-row]');
  const nameInput = panel.querySelector('[data-name-input]');
  const callBtn = panel.querySelector('[data-call]');

  let activeCall = null,
    activeCallUI = null,
    callConversationId = null;
  function notifyCallStarted(conversationId) {
    fetch('/api/calls?type=notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }
  function notifyCallMissed(conversationId) {
    fetch('/api/calls?type=missed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }
  function beginInSiteCall(conversationId) {
    activeCall.startCall();
    notifyCallStarted(conversationId);
  }
  function ensureCallFor(conversationId) {
    if (!sb || !window.VeronzaCall || !conversationId) return;
    if (activeCall && callConversationId === conversationId) return;
    activeCallUI?.destroy();
    activeCall?.destroy();
    activeCall = new window.VeronzaCall(sb, conversationId);
    activeCallUI = window.VeronzaCall.mountUI(activeCall, {
      calleeLabel: 'المتجر',
      onMissedCall: () => notifyCallMissed(conversationId),
    });
    callConversationId = conversationId;
    callBtn.hidden = false;
    callBtn.onclick = () => {
      window.VeronzaCall.showChoice({
        phone: STORE_PHONE,
        onInSite: () => beginInSiteCall(conversationId),
      });
    };
  }
  window.veronzaStartInSiteCall = async () => {
    const s = await ensureConversation();
    ensureCallFor(s.conversation_id);
    openPanel();
    beginInSiteCall(s.conversation_id);
  };

  function renderMessages(messages) {
    if (!messages.length) return;
    seenIds = new Set(messages.map((m) => m.id).filter((id) => id != null));
    bodyEl.innerHTML = messages
      .map(
        (m) =>
          `<div class="vz-chat-msg ${m.sender}">${esc(m.body)}<time>${fmtTime(m.created_at)}</time></div>`,
      )
      .join('');
    bodyEl.scrollTop = bodyEl.scrollHeight;
    lastMessageAt = messages[messages.length - 1].created_at;
  }

  function appendMessage(m) {
    if (m.id != null) {
      if (seenIds.has(m.id)) return;
      seenIds.add(m.id);
    }
    if (bodyEl.querySelector('.vz-chat-welcome')) bodyEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = `vz-chat-msg ${m.sender}`;
    div.innerHTML = `${esc(m.body)}<time>${fmtTime(m.created_at)}</time>`;
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    if (m.created_at && (!lastMessageAt || m.created_at > lastMessageAt)) lastMessageAt = m.created_at;
  }

  async function ensureConversation() {
    if (session?.conversation_id && session?.guest_token) return session;
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', customer_name: nameInput.value.trim() }),
    });
    if (!r.ok) throw new Error('تعذر بدء المحادثة');
    const data = await r.json();
    saveSession({ conversation_id: data.conversation_id, guest_token: data.guest_token });
    ensureCallFor(data.conversation_id);
    return session;
  }

  async function poll(showUnread) {
    if (!session?.conversation_id) return;
    try {
      const params = new URLSearchParams({
        conversation_id: session.conversation_id,
        guest_token: session.guest_token,
      });
      if (lastMessageAt) params.set('since', lastMessageAt);
      const r = await fetch('/api/chat?' + params.toString());
      if (!r.ok) return;
      const data = await r.json();
      // A send that started after this fetch went out will reconcile
      // seenIds/lastMessageAt itself once it resolves - applying this
      // batch too could re-render the same message the send just added.
      if (sending) return;
      const newMsgs = data.messages || [];
      if (newMsgs.length) {
        if (panelOpen) newMsgs.forEach(appendMessage);
        else {
          lastMessageAt = newMsgs[newMsgs.length - 1].created_at;
          const adminMsgs = newMsgs.filter((m) => m.sender === 'admin');
          if (adminMsgs.length) {
            unreadCount += adminMsgs.length;
            updateUnreadBadge();
            notifyNewMessage(adminMsgs[adminMsgs.length - 1].body);
          }
        }
      }
    } catch (_) {}
  }

  function notifyNewMessage(preview) {
    try {
      if (typeof window.veronzaToast === 'function') {
        window.veronzaToast(`رسالة جديدة من Veronza: ${preview}`.slice(0, 120), 4500);
      }
      new Audio(
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
      ).play();
    } catch (_) {}
  }

  function updateUnreadBadge() {
    chatTriggers.forEach((t) => {
      const badge = t.querySelector('.vz-chat-badge');
      if (!badge) return;
      badge.hidden = unreadCount <= 0;
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => poll(false), 4000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }
  function startIdlePolling() {
    stopIdlePolling();
    idleTimer = setInterval(() => poll(true), 15000);
  }
  function stopIdlePolling() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session?.conversation_id) poll(!panelOpen);
  });
  window.addEventListener('focus', () => {
    if (session?.conversation_id) poll(!panelOpen);
  });

  async function openPanel() {
    panelOpen = true;
    panel.classList.add('open');
    window.syncBodyScrollLock?.();
    unreadCount = 0;
    updateUnreadBadge();
    stopIdlePolling();
    nameRow.hidden = !!session?.conversation_id;
    if (session?.conversation_id) {
      try {
        const params = new URLSearchParams({
          conversation_id: session.conversation_id,
          guest_token: session.guest_token,
        });
        const r = await fetch('/api/chat?' + params.toString());
        if (r.ok) {
          const data = await r.json();
          if (data.messages?.length) renderMessages(data.messages);
        }
      } catch (_) {}
    }
    startPolling();
    setTimeout(() => inputEl.focus(), 300);
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove('open');
    window.syncBodyScrollLock?.();
    stopPolling();
    if (session?.conversation_id) startIdlePolling();
  }

  chatTriggers.forEach((t) =>
    t.addEventListener('click', (e) => {
      e.preventDefault();
      if (t.closest('[data-mobile-menu]')) window.closeLayers?.();
      panelOpen ? closePanel() : openPanel();
    }),
  );
  panel.querySelector('.vz-chat-close').onclick = closePanel;
  window.attachSwipeDownToClose?.(panel, closePanel, { scrollEl: bodyEl });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || sending) return;
    sending = true;
    inputEl.disabled = true;
    try {
      await ensureConversation();
      const optimistic = { sender: 'customer', body: text, created_at: new Date().toISOString() };
      appendMessage(optimistic);
      inputEl.value = '';
      nameRow.hidden = true;
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          conversation_id: session.conversation_id,
          guest_token: session.guest_token,
          body: text,
          customer_name: nameInput.value.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error('failed');
      const result = await r.json();
      if (result?.message) {
        if (result.message.id != null) seenIds.add(result.message.id);
        if (
          result.message.created_at &&
          (!lastMessageAt || result.message.created_at > lastMessageAt)
        )
          lastMessageAt = result.message.created_at;
      }
    } catch (_) {
      const div = document.createElement('div');
      div.className = 'vz-chat-welcome';
      div.textContent = 'تعذر إرسال الرسالة، تحقق من الاتصال وحاول مرة أخرى.';
      bodyEl.appendChild(div);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    } finally {
      sending = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  });

  window.veronzaOpenChat = openPanel;
  window.veronzaHasChatSession = () => !!session?.conversation_id;

  if (session?.conversation_id) {
    startIdlePolling();
    ensureCallFor(session.conversation_id);
  }
})();
