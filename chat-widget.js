(()=>{
  const STORAGE_KEY='veronza-chat-session';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){session=null}
  let panelOpen=false,pollTimer=null,idleTimer=null,lastMessageAt=null,sending=false;

  function saveSession(s){session=s;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s))}catch(_){}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function fmtTime(d){return new Date(d).toLocaleTimeString('ar-LY',{hour:'2-digit',minute:'2-digit'})}

  if(!document.getElementById('vz-chat-style')){
    const s=document.createElement('style');
    s.id='vz-chat-style';
    s.textContent=`
      .vz-chat-badge{display:inline-block;width:8px;height:8px;border-radius:50%;background:#b21f2d;margin-inline-start:6px;vertical-align:middle}
      .vz-chat-panel{position:fixed;left:50%;bottom:0;transform:translate(-50%,110%);width:min(100%,400px);max-height:78vh;background:#fff;z-index:95;display:flex;flex-direction:column;border-radius:24px 24px 0 0;box-shadow:0 -15px 40px rgba(0,0,0,.2);transition:.3s;overflow:hidden}
      .vz-chat-panel.open{transform:translate(-50%,0)}
      .vz-chat-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;padding-top:max(16px,calc(env(safe-area-inset-top) + 8px));border-bottom:1px solid #eee;background:#faf9f7}
      .vz-chat-head strong{font-family:'Playfair Display',serif;font-size:16px}
      .vz-chat-head small{display:block;color:#777;font-size:11px;margin-top:2px}
      .vz-chat-close{border:0;background:#f4f1ec;width:32px;height:32px;border-radius:50%;font-size:18px}
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
      @media(min-width:700px){.vz-chat-panel{border-radius:24px;max-width:420px}}
    `;
    document.head.appendChild(s);
  }

  const chatTriggers=Array.from(document.querySelectorAll('[data-chat-open]'));
  if(!chatTriggers.length)return;

  const panel=document.createElement('div');
  panel.className='vz-chat-panel';
  panel.innerHTML=`
    <div class="vz-chat-head"><div><strong>تواصل مع Veronza</strong><small>عادة نرد خلال دقائق</small></div><button type="button" class="vz-chat-close" aria-label="إغلاق">×</button></div>
    <div class="vz-chat-name-row" data-name-row hidden><input type="text" data-name-input placeholder="اسمك (اختياري)"></div>
    <div class="vz-chat-body" data-body><div class="vz-chat-welcome">أهلاً 👋 اكتب لنا أي سؤال عن المنتجات أو الطلب وبنرد عليك بأقرب وقت.</div></div>
    <form class="vz-chat-foot" data-form><input type="text" data-input placeholder="اكتب رسالتك..." autocomplete="off" required><button type="submit">إرسال</button></form>
  `;
  document.body.appendChild(panel);

  const bodyEl=panel.querySelector('[data-body]');
  const formEl=panel.querySelector('[data-form]');
  const inputEl=panel.querySelector('[data-input]');
  const nameRow=panel.querySelector('[data-name-row]');
  const nameInput=panel.querySelector('[data-name-input]');

  function renderMessages(messages){
    if(!messages.length)return;
    bodyEl.innerHTML=messages.map(m=>`<div class="vz-chat-msg ${m.sender}">${esc(m.body)}<time>${fmtTime(m.created_at)}</time></div>`).join('');
    bodyEl.scrollTop=bodyEl.scrollHeight;
    lastMessageAt=messages[messages.length-1].created_at;
  }

  function appendMessage(m){
    if(bodyEl.querySelector('.vz-chat-welcome'))bodyEl.innerHTML='';
    const div=document.createElement('div');
    div.className=`vz-chat-msg ${m.sender}`;
    div.innerHTML=`${esc(m.body)}<time>${fmtTime(m.created_at)}</time>`;
    bodyEl.appendChild(div);
    bodyEl.scrollTop=bodyEl.scrollHeight;
    lastMessageAt=m.created_at;
  }

  async function ensureConversation(){
    if(session?.conversation_id&&session?.guest_token)return session;
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',customer_name:nameInput.value.trim()})});
    if(!r.ok)throw new Error('تعذر بدء المحادثة');
    const data=await r.json();
    saveSession({conversation_id:data.conversation_id,guest_token:data.guest_token});
    return session;
  }

  async function poll(showUnread){
    if(!session?.conversation_id)return;
    try{
      const params=new URLSearchParams({conversation_id:session.conversation_id,guest_token:session.guest_token});
      if(lastMessageAt)params.set('since',lastMessageAt);
      const r=await fetch('/api/chat?'+params.toString());
      if(!r.ok)return;
      const data=await r.json();
      const newMsgs=data.messages||[];
      if(newMsgs.length){
        if(panelOpen)newMsgs.forEach(appendMessage);
        else{lastMessageAt=newMsgs[newMsgs.length-1].created_at;if(newMsgs.some(m=>m.sender==='admin'))showUnreadDot(true)}
      }
    }catch(_){}
  }

  function showUnreadDot(show){
    chatTriggers.forEach(t=>{const badge=t.querySelector('.vz-chat-badge');if(badge)badge.hidden=!show});
  }

  function startPolling(){
    stopPolling();
    pollTimer=setInterval(()=>poll(false),4000);
  }
  function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=null}
  function startIdlePolling(){
    stopIdlePolling();
    idleTimer=setInterval(()=>poll(true),25000);
  }
  function stopIdlePolling(){if(idleTimer)clearInterval(idleTimer);idleTimer=null}

  async function openPanel(){
    panelOpen=true;
    panel.classList.add('open');
    showUnreadDot(false);
    stopIdlePolling();
    nameRow.hidden=!!(session?.conversation_id);
    if(session?.conversation_id){
      try{
        const params=new URLSearchParams({conversation_id:session.conversation_id,guest_token:session.guest_token});
        const r=await fetch('/api/chat?'+params.toString());
        if(r.ok){const data=await r.json();if(data.messages?.length)renderMessages(data.messages)}
      }catch(_){}
    }
    startPolling();
    setTimeout(()=>inputEl.focus(),300);
  }

  function closePanel(){
    panelOpen=false;
    panel.classList.remove('open');
    stopPolling();
    if(session?.conversation_id)startIdlePolling();
  }

  chatTriggers.forEach(t=>t.addEventListener('click',e=>{e.preventDefault();if(t.closest('[data-mobile-menu]'))window.closeLayers?.();panelOpen?closePanel():openPanel()}));
  panel.querySelector('.vz-chat-close').onclick=closePanel;

  formEl.addEventListener('submit',async e=>{
    e.preventDefault();
    const text=inputEl.value.trim();
    if(!text||sending)return;
    sending=true;
    inputEl.disabled=true;
    try{
      await ensureConversation();
      const optimistic={sender:'customer',body:text,created_at:new Date().toISOString()};
      appendMessage(optimistic);
      inputEl.value='';
      nameRow.hidden=true;
      const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',conversation_id:session.conversation_id,guest_token:session.guest_token,body:text,customer_name:nameInput.value.trim()||undefined})});
      if(!r.ok)throw new Error('failed');
    }catch(_){
      const div=document.createElement('div');
      div.className='vz-chat-welcome';
      div.textContent='تعذر إرسال الرسالة، تحقق من الاتصال وحاول مرة أخرى.';
      bodyEl.appendChild(div);
      bodyEl.scrollTop=bodyEl.scrollHeight;
    }finally{
      sending=false;
      inputEl.disabled=false;
      inputEl.focus();
    }
  });

  if(session?.conversation_id)startIdlePolling();
})();
