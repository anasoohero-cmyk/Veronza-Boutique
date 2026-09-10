(() => {
  const quantityBridge = document.createElement('script');
  quantityBridge.src = 'product-quantity.js';
  quantityBridge.defer = true;
  document.head.appendChild(quantityBridge);

  const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOU8GTPj';

  const loadClient = () => new Promise((resolve, reject) => {
    if (window.supabase?.createClient) return resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY));
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = () => window.supabase?.createClient ? resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)) : reject(new Error('تعذر تحميل خدمة الحساب'));
    s.onerror = () => reject(new Error('تعذر تحميل خدمة الحساب'));
    document.head.appendChild(s);
  });

  const start = async () => {
    const client = await loadClient();
    window.veronzaSupabase = client;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      if (requestUrl.includes('/api/send-order')) {
        const { data: { session } } = await client.auth.getSession();
        if (session?.access_token) {
          const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
          headers.set('Authorization', `Bearer ${session.access_token}`);
          init = { ...init, headers };
        }
      }
      return nativeFetch(input, init);
    };

    const style = document.createElement('style');
    style.textContent = `.account-btn{position:relative}.account-btn span{display:block;font-size:10px;line-height:1;margin-top:2px}.auth-modal{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:flex-end;justify-content:center;z-index:120}.auth-modal.open{display:flex}.auth-card{width:min(100%,560px);max-height:92vh;overflow:auto;background:#fff;border-radius:24px 24px 0 0;padding:24px;box-sizing:border-box}.auth-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.auth-head h2{margin:0}.auth-close{border:0;background:#f4f1ec;width:40px;height:40px;border-radius:50%;font-size:24px}.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.auth-tabs button{border:1px solid #ddd8d0;background:#fff;border-radius:11px;padding:11px;font:inherit;font-weight:700}.auth-tabs button.active{background:#111;color:#fff;border-color:#111}.auth-form{display:grid;gap:12px}.auth-form label{display:grid;gap:7px;font-size:13px;font-weight:700}.auth-form input{width:100%;box-sizing:border-box;border:1px solid #ddd8d0;border-radius:12px;padding:13px;font:inherit}.auth-submit{border:0;background:#111;color:#fff;padding:14px;border-radius:12px;font:inherit;font-weight:800}.auth-note{font-size:12px;line-height:1.7;color:#777;margin:0}.auth-status{font-size:13px;line-height:1.6;margin:0}.auth-account{display:grid;gap:12px}.auth-order{border:1px solid #e5e0d8;border-radius:12px;padding:12px}.auth-order strong{display:block}.auth-secondary{border:1px solid #ddd8d0;background:#fff;padding:12px;border-radius:12px;font:inherit;font-weight:700}.auth-hidden{display:none}@media(min-width:901px){.auth-modal{align-items:center}.auth-card{border-radius:24px}}`;
    document.head.appendChild(style);

    const cartFix = document.createElement('style');
    cartFix.textContent = '@media(max-width:900px){.cart-drawer:not(.open){right:-100%!important;transform:none!important;visibility:hidden!important}.cart-drawer.open{right:18%;transform:none!important;visibility:visible!important}}';
    document.head.appendChild(cartFix);

    const button = document.createElement('button');
    button.className = 'icon-btn account-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'حساب الزبون');
    button.innerHTML = '♙<span>حسابي</span>';
    document.querySelector('.header-actions')?.prepend(button);

    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.innerHTML = `<div class="auth-card"><div class="auth-head"><h2>حساب Veronza</h2><button class="auth-close" type="button" aria-label="إغلاق">×</button></div><div class="auth-tabs"><button type="button" class="active" data-auth-tab="login">تسجيل الدخول</button><button type="button" data-auth-tab="signup">إنشاء حساب</button></div><form class="auth-form" data-auth-form><label>الإيميل<input type="email" name="email" autocomplete="email" placeholder="example@email.com" required></label><label>كلمة المرور<input type="password" name="password" autocomplete="current-password" placeholder="6 أحرف أو أكثر" minlength="6" required></label><label data-auth-name class="auth-hidden">الاسم الكامل<input type="text" name="full_name" autocomplete="name" placeholder="اسمك الكامل"></label><button class="auth-submit" type="submit">دخول</button><p class="auth-status" data-auth-status></p><p class="auth-note">الحساب اختياري بالكامل. تقدر تكمل الشراء كزائر بدون تسجيل. تسجيل الهاتف عبر SMS نفعّله بعد تجهيز مزود الرسائل، بدون تعطيل الشراء كزائر.</p></form><div class="auth-account auth-hidden" data-auth-account><strong data-auth-welcome></strong><div data-auth-orders></div><button class="auth-secondary" type="button" data-auth-logout>تسجيل الخروج</button></div></div>`;
    document.body.appendChild(modal);

    const tabs = [...modal.querySelectorAll('[data-auth-tab]')];
    const form = modal.querySelector('[data-auth-form]');
    const status = modal.querySelector('[data-auth-status]');
    const account = modal.querySelector('[data-auth-account]');
    const nameField = modal.querySelector('[data-auth-name]');
    const submit = modal.querySelector('.auth-submit');
    let mode = 'login';

    const setStatus = (text='') => { status.textContent = text; };
    const showAccount = async (session) => {
      if (!session) { form.classList.remove('auth-hidden'); account.classList.add('auth-hidden'); return; }
      form.classList.add('auth-hidden'); account.classList.remove('auth-hidden');
      const { data: profile } = await client.from('customer_profiles').select('full_name,phone').eq('id', session.user.id).maybeSingle();
      modal.querySelector('[data-auth-welcome]').textContent = `أهلاً ${profile?.full_name || session.user.email || 'بك'} 👋`;
      const { data: orders } = await client.from('orders').select('order_number,total,status,created_at').eq('user_id', session.user.id).order('created_at', { ascending:false }).limit(10);
      modal.querySelector('[data-auth-orders]').innerHTML = orders?.length ? `<strong>طلباتي السابقة</strong>${orders.map(o=>`<div class="auth-order"><strong>${o.order_number}</strong><span>${Number(o.total).toLocaleString('ar-LY')} د.ل · ${o.status}</span></div>`).join('')}` : '<p class="auth-note">ما عندكش طلبات مسجلة في الحساب حتى الآن.</p>';
    };

    tabs.forEach(tab => tab.onclick = () => { mode = tab.dataset.authTab; tabs.forEach(x=>x.classList.toggle('active', x===tab)); nameField.classList.toggle('auth-hidden', mode!=='signup'); submit.textContent = mode==='signup' ? 'إنشاء الحساب' : 'دخول'; form.querySelector('input[name="password"]').autocomplete = mode==='signup' ? 'new-password' : 'current-password'; setStatus(''); });
    button.onclick = async () => { modal.classList.add('open'); const {data:{session}} = await client.auth.getSession(); await showAccount(session); };
    modal.querySelector('.auth-close').onclick = () => modal.classList.remove('open');
    modal.onclick = e => { if(e.target===modal) modal.classList.remove('open'); };
    modal.querySelector('[data-auth-logout]').onclick = async () => { await client.auth.signOut(); await showAccount(null); setStatus('تم تسجيل الخروج.'); form.reset(); };

    form.onsubmit = async e => {
      e.preventDefault(); setStatus('جاري التنفيذ...'); submit.disabled = true;
      const fd = new FormData(form), email = String(fd.get('email')||'').trim(), password = String(fd.get('password')||''), full_name = String(fd.get('full_name')||'').trim();
      try {
        if(mode==='signup') {
          const {data,error} = await client.auth.signUp({email,password,options:{data:{full_name},emailRedirectTo:'https://veronza.vercel.app/'}});
          if(error) throw error;
          if(data.session) {
            await showAccount(data.session);
            setStatus('تم إنشاء الحساب وتسجيل الدخول مباشرة.');
          } else {
            setStatus('تم إنشاء الحساب. تقدر تسجل الدخول مباشرة من تبويب تسجيل الدخول.');
          }
        } else {
          const {data,error} = await client.auth.signInWithPassword({email,password});
          if(error) throw error;
          await showAccount(data.session); setStatus('تم تسجيل الدخول.'); modal.classList.remove('open');
        }
      } catch(err) { setStatus(err?.message || 'حدث خطأ، حاول مرة أخرى.'); }
      finally { submit.disabled = false; }
    };

    client.auth.onAuthStateChange(async (_event, session) => { if(modal.classList.contains('open')) await showAccount(session); });
  };

  start().catch(err => console.error('Veronza auth:', err));
})();
