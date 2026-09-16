const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.veronzaSupabase = sb;
const $ = (s) => document.querySelector(s);
let conversations = [],
  activeId = null,
  activeMessages = [];

function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}
function toast(t) {
  const x = $('#toast');
  x.textContent = t;
  x.classList.add('show');
  setTimeout(() => x.classList.remove('show'), 2600);
}
let currentPermissions = { view: false, edit: false };
function showApp(session) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
}
function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

function applyChatPermissions(adminCheck) {
  currentPermissions = adminCheck.permissions?.chat || { view: false, edit: false };
  $('#usersMenuLink')?.toggleAttribute('hidden', adminCheck.role !== 'owner');
  $('#replyInput').disabled = !currentPermissions.edit;
  $('#replyForm').querySelector('button')?.toggleAttribute('disabled', !currentPermissions.edit);
  $('#closeConversationBtn').hidden = !currentPermissions.edit;
  if (!currentPermissions.view) {
    document.querySelector('main.chat-main').innerHTML =
      '<p style="text-align:center;color:#888;padding:40px 16px;grid-column:1/-1">ماعندك صلاحية الوصول لقسم الرسائل.</p>';
  }
}

async function checkAdmin(token) {
  const r = await fetch('/api/admin-auth', { headers: { Authorization: `Bearer ${token}` } });
  let data = {};
  try {
    data = await r.json();
  } catch (_) {}
  if (!r.ok || data.ok !== true) return { ok: false };
  return { ok: true, role: data.role, permissions: data.permissions || {} };
}

function fmtTime(d) {
  return new Date(d).toLocaleString('ar-LY', { dateStyle: 'short', timeStyle: 'short' });
}
function initials(name) {
  const n = (name || '؟').trim();
  return n ? n[0] : '؟';
}

function renderConversationList() {
  const box = $('#conversationList');
  if (!conversations.length) {
    box.innerHTML = '<div class="chat-empty-state">ما فيه محادثات حتى الآن.</div>';
    return;
  }
  box.innerHTML = conversations
    .map(
      (c) =>
        `<div class="conversation-row${c.id === activeId ? ' active' : ''}" data-id="${c.id}">${c.admin_unread ? '<span class="conversation-unread"></span>' : ''}<div class="conversation-avatar">${esc(initials(c.customer_name))}</div><div class="conversation-info"><div class="conversation-name">${esc(c.customer_name || 'زائر')}${c.status === 'closed' ? ' · منتهية' : ''}</div><div class="conversation-preview">${esc(c.last_message_preview || '')}</div></div><div class="conversation-time">${fmtTime(c.last_message_at)}</div></div>`,
    )
    .join('');
  box
    .querySelectorAll('[data-id]')
    .forEach((el) => (el.onclick = () => openConversation(el.dataset.id)));
}

async function loadConversations() {
  const { data, error } = await sb
    .from('chat_conversations')
    .select('id,customer_name,customer_phone,status,admin_unread,last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) {
    toast(error.message);
    return;
  }
  const withPreview = await Promise.all(
    (data || []).map(async (c) => {
      const { data: last } = await sb
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
  renderConversationList();
  $('#lastUpdated').textContent =
    'آخر تحديث ' + new Date().toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
}

function renderMessages() {
  const box = $('#chatMessages');
  box.innerHTML =
    activeMessages
      .map(
        (m) =>
          `<div class="chat-bubble ${m.sender}">${esc(m.body)}<time>${fmtTime(m.created_at)}</time></div>`,
      )
      .join('') || '<div class="chat-empty-state">ما فيه رسائل حتى الآن.</div>';
  box.scrollTop = box.scrollHeight;
}

async function openConversation(id) {
  activeId = id;
  renderConversationList();
  $('#threadEmpty').hidden = true;
  $('#threadView').hidden = false;
  document.querySelector('main.chat-main').classList.add('thread-open');
  const conv = conversations.find((c) => c.id === id);
  $('#threadName').textContent = conv?.customer_name || 'زائر';
  $('#threadPhone').textContent = conv?.customer_phone || '';
  const { data, error } = await sb
    .from('chat_messages')
    .select('id,sender,body,created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    toast(error.message);
    return;
  }
  activeMessages = data || [];
  renderMessages();
  if (conv && conv.admin_unread) {
    await sb.from('chat_conversations').update({ admin_unread: false }).eq('id', id);
    conv.admin_unread = false;
    renderConversationList();
  }
}

function closeThread() {
  activeId = null;
  document.querySelector('main.chat-main').classList.remove('thread-open');
  $('#threadEmpty').hidden = false;
  $('#threadView').hidden = true;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(),
    password: $('#password').value,
  });
  if (error) {
    $('#loginError').textContent = error.message;
    return;
  }
  const adminCheck = await checkAdmin(data.session.access_token);
  if (!adminCheck.ok) {
    await sb.auth.signOut();
    $('#loginError').textContent = 'هذا الحساب غير مصرح له بالدخول.';
    return;
  }
  showApp(data.session);
  applyChatPermissions(adminCheck);
  if (currentPermissions.view) loadConversations();
});
$('#logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  showLogin();
};
$('#refreshBtn').onclick = loadConversations;
$('#backToList').onclick = closeThread;

$('#replyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#replyInput');
  const text = input.value.trim();
  if (!text || !activeId) return;
  input.disabled = true;
  const { data, error } = await sb
    .from('chat_messages')
    .insert({ conversation_id: activeId, sender: 'admin', body: text })
    .select()
    .single();
  if (error) {
    toast(error.message);
    input.disabled = false;
    return;
  }
  await sb
    .from('chat_conversations')
    .update({ customer_unread: true, last_message_at: new Date().toISOString(), status: 'open' })
    .eq('id', activeId);
  activeMessages.push(data);
  renderMessages();
  input.value = '';
  input.disabled = false;
  input.focus();
  loadConversations();
});

$('#closeConversationBtn').onclick = async () => {
  if (!activeId) return;
  await sb.from('chat_conversations').update({ status: 'closed' }).eq('id', activeId);
  toast('تم إنهاء المحادثة');
  loadConversations();
};

sb.channel('veronza-admin-chat')
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
        sb.from('chat_conversations').update({ admin_unread: false }).eq('id', activeId);
      }
      loadConversations();
      try {
        new Audio(
          'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
        ).play();
      } catch (_) {}
    },
  )
  .subscribe();

(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) {
    const adminCheck = await checkAdmin(session.access_token);
    if (adminCheck.ok) {
      showApp(session);
      applyChatPermissions(adminCheck);
      if (currentPermissions.view) loadConversations();
    } else {
      await sb.auth.signOut();
      showLogin();
    }
  } else {
    showLogin();
  }
})();

setInterval(() => {
  if (!$('#appView').classList.contains('hidden')) loadConversations();
}, 30000);
