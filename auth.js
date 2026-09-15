(() => {
  const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';

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
    style.textContent = `.account-btn{position:relative}.account-btn span{display:block;font-size:10px;line-height:1;margin-top:2px}.auth-modal{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:flex-end;justify-content:center;z-index:120}.auth-modal.open{display:flex}.auth-card{width:min(100%,560px);max-height:92vh;overflow:auto;overscroll-behavior:contain;background:#fff;border-radius:24px 24px 0 0;padding:24px;box-sizing:border-box}.auth-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.auth-head h2{margin:0}.auth-close{border:0;background:#f4f1ec;width:40px;height:40px;border-radius:50%;font-size:24px}.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.auth-tabs button{border:1px solid #ddd8d0;background:#fff;border-radius:11px;padding:11px;font:inherit;font-weight:700}.auth-tabs button.active{background:#111;color:#fff;border-color:#111}.auth-form{display:grid;gap:12px}.auth-form label{display:grid;gap:7px;font-size:13px;font-weight:700}.auth-form input{width:100%;box-sizing:border-box;border:1px solid #ddd8d0;border-radius:12px;padding:13px;font:inherit}.auth-submit{border:0;background:#111;color:#fff;padding:14px;border-radius:12px;font:inherit;font-weight:800}.auth-note{font-size:12px;line-height:1.7;color:#777;margin:0}.auth-status{font-size:13px;line-height:1.6;margin:0}.auth-account{display:grid;gap:20px}.auth-order{border:1px solid #e5e0d8;border-radius:12px;padding:12px;margin-bottom:10px}.auth-order strong{display:block}.auth-secondary{border:1px solid #ddd8d0;background:#fff;padding:12px;border-radius:12px;font:inherit;font-weight:700;width:100%}.auth-hidden{display:none}.auth-section{border:1px solid #eee;border-radius:14px;padding:14px}.auth-section h3{margin:0 0 12px;font-size:15px}.auth-section label{display:grid;gap:6px;font-size:12px;font-weight:700;margin-bottom:10px}.auth-section input,.auth-section textarea{width:100%;box-sizing:border-box;border:1px solid #ddd8d0;border-radius:10px;padding:10px;font:inherit}.auth-order-actions{display:flex;gap:8px;margin-top:8px}.auth-link{border:0;background:none;color:#111;font-weight:800;font-size:12px;text-decoration:underline;padding:0;cursor:pointer}.auth-order-detail{margin-top:10px;border-top:1px dashed #ddd;padding-top:10px}.auth-order-item{display:flex;justify-content:space-between;font-size:12px;padding:4px 0}.auth-address{border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.auth-address strong{display:block;font-size:12px}.auth-address span{font-size:11px;color:#777}.auth-address-remove{border:0;background:none;color:#b42318;font-size:12px;font-weight:700;cursor:pointer}@media(min-width:901px){.auth-modal{align-items:center}.auth-card{border-radius:24px}}`;
    document.head.appendChild(style);


    const button = document.createElement('button');
    button.className = 'icon-btn account-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'حساب الزبون');
    button.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg><span>حسابي</span>';
    document.querySelector('.header-actions')?.prepend(button);

    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.innerHTML = `<div class="auth-card"><div class="auth-head"><h2>حساب Veronza</h2><button class="auth-close" type="button" aria-label="إغلاق">×</button></div><div class="auth-tabs" data-auth-tabs><button type="button" class="active" data-auth-tab="login">تسجيل الدخول</button><button type="button" data-auth-tab="signup">إنشاء حساب</button></div><form class="auth-form" data-auth-form><label>الإيميل<input type="email" name="email" autocomplete="email" placeholder="example@email.com" required></label><label>كلمة المرور<input type="password" name="password" autocomplete="current-password" placeholder="6 أحرف أو أكثر" minlength="6" required></label><label data-auth-name class="auth-hidden">الاسم الكامل<input type="text" name="full_name" autocomplete="name" placeholder="اسمك الكامل"></label><button class="auth-submit" type="submit">دخول</button><button type="button" class="auth-link" data-forgot-password>نسيت كلمة المرور؟</button><p class="auth-status" data-auth-status></p><p class="auth-note">الحساب اختياري بالكامل. تقدر تكمل الشراء كزائر بدون تسجيل.</p></form><div class="auth-track"><strong>تتبع طلب سابق</strong><p class="auth-note">عندك طلب قديم وما سجلتش دخول؟ دخل رقم هاتفك ورقم الطلب.</p><label>رقم الهاتف<input type="tel" inputmode="tel" data-track-phone placeholder="مثال: 0912345678"></label><label>رقم الطلب<input type="text" data-track-number placeholder="مثال: VZ-172..."></label><button class="auth-secondary" type="button" data-track-submit>تتبع الطلب</button><div data-track-result></div></div><div class="auth-account auth-hidden" data-auth-account><strong data-auth-welcome></strong><div class="auth-section"><h3>بياناتي</h3><label>الاسم الكامل<input type="text" data-profile-name></label><label>رقم الهاتف<input type="tel" inputmode="tel" data-profile-phone></label><label>المقاس المفضل<input type="text" data-profile-size placeholder="مثال: 40"></label><label class="checkout-consent"><input type="checkbox" data-profile-marketing> أوافق على استلام آخر العروض والمنتجات الجديدة عبر واتساب</label><button class="auth-secondary" type="button" data-profile-save>حفظ البيانات</button><p class="auth-status" data-profile-status></p></div><div class="auth-section"><h3>عناويني</h3><div data-address-list></div><label>تسمية العنوان<input type="text" data-address-label placeholder="مثال: المنزل، العمل"></label><label>تفاصيل العنوان<textarea data-address-text rows="2" placeholder="المدينة، المنطقة، الشارع"></textarea></label><button class="auth-secondary" type="button" data-address-add>إضافة العنوان</button></div><div class="auth-section"><h3>طلباتي</h3><div data-auth-orders></div></div><button class="auth-secondary" type="button" data-auth-logout>تسجيل الخروج</button></div></div>`;
    document.body.appendChild(modal);

    const tabs = [...modal.querySelectorAll('[data-auth-tab]')];
    const tabsBar = modal.querySelector('[data-auth-tabs]');
    const trackSection = modal.querySelector('.auth-track');
    const form = modal.querySelector('[data-auth-form]');
    const status = modal.querySelector('[data-auth-status]');
    const account = modal.querySelector('[data-auth-account]');
    const nameField = modal.querySelector('[data-auth-name]');
    const submit = modal.querySelector('.auth-submit');
    let mode = 'login';

    const setStatus = (text='') => { status.textContent = text; };
    let currentUserId = null;

    const statusLabel = s => ({pending:'قيد المراجعة',confirmed:'تم التأكيد',preparing:'قيد التجهيز',shipped:'تم الشحن',delivered:'تم التسليم',cancelled:'ملغي',returned:'مرتجع'}[s] || s || '—');

    const renderAddresses = async () => {
      const box = modal.querySelector('[data-address-list]');
      const { data: addresses } = await client.from('customer_addresses').select('id,label,address').eq('user_id', currentUserId).order('created_at', { ascending:false });
      box.innerHTML = addresses?.length ? addresses.map(a => `<div class="auth-address"><div><strong>${a.label}</strong><span>${a.address}</span></div><button type="button" class="auth-address-remove" data-address-remove="${a.id}">حذف</button></div>`).join('') : '<p class="auth-note">ما عندكش عناوين محفوظة بعد.</p>';
      box.querySelectorAll('[data-address-remove]').forEach(btn => btn.onclick = async () => {
        await client.from('customer_addresses').delete().eq('id', btn.dataset.addressRemove).eq('user_id', currentUserId);
        renderAddresses();
      });
    };

    const renderOrderItemsHtml = items => (items || []).map(it => `<div class="auth-order-item"><span>${it.product_name || it.name} × ${it.quantity || it.qty}${it.color ? ' · ' + it.color : ''}${it.size ? ' · ' + it.size : ''}</span><span>${Number((it.unit_price||it.price||0)*(it.quantity||it.qty||1)).toLocaleString('ar-LY')} د.ل</span></div>`).join('');

    const reorderItems = items => {
      let added = 0;
      (items || []).forEach(it => {
        const code = it.product_code || it.code;
        const p = (window.products || []).find(x => String(x.code) === String(code));
        if (!p) return;
        const size = it.size || 'موحد';
        const existing = window.cart?.find?.(c => c.id === p.id && c.color === (it.color||p.colors?.[0]) && c.size === size);
        if (existing) existing.qty += (it.quantity || it.qty || 1);
        else window.cart?.push?.({ ...p, qty: it.quantity || it.qty || 1, color: it.color || p.colors?.[0] || '', size });
        added++;
      });
      if (added) { window.save?.(); window.renderCart?.(); window.openCart?.(); modal.classList.remove('open'); }
      else alert('تعذر إعادة الطلب — المنتجات القديمة قد تكون غير متوفرة حالياً.');
    };

    const showAccount = async (session) => {
      if (!session) { form.classList.remove('auth-hidden'); tabsBar.classList.remove('auth-hidden'); trackSection.classList.remove('auth-hidden'); account.classList.add('auth-hidden'); currentUserId = null; return; }
      form.classList.add('auth-hidden'); tabsBar.classList.add('auth-hidden'); trackSection.classList.add('auth-hidden'); account.classList.remove('auth-hidden');
      currentUserId = session.user.id;
      const { data: profile } = await client.from('customer_profiles').select('full_name,phone,preferred_size,marketing_opt_in').eq('id', session.user.id).maybeSingle();
      modal.querySelector('[data-auth-welcome]').textContent = `أهلاً ${profile?.full_name || session.user.email || 'بك'} 👋`;
      modal.querySelector('[data-profile-name]').value = profile?.full_name || '';
      modal.querySelector('[data-profile-phone]').value = profile?.phone || '';
      modal.querySelector('[data-profile-size]').value = profile?.preferred_size || '';
      modal.querySelector('[data-profile-marketing]').checked = !!profile?.marketing_opt_in;

      await renderAddresses();

      try {
        const { data: remoteWishlist } = await client.from('wishlist_items').select('product_id').eq('user_id', session.user.id);
        const remoteIds = (remoteWishlist || []).map(r => r.product_id);
        const localIds = Array.isArray(window.wishlist) ? window.wishlist : [];
        const toUpload = localIds.filter(id => !remoteIds.includes(id));
        if (toUpload.length) await client.from('wishlist_items').insert(toUpload.map(product_id => ({ user_id: session.user.id, product_id })));
        const merged = [...new Set([...remoteIds, ...localIds])];
        if (typeof window.setWishlist === 'function') window.setWishlist(merged);
      } catch (_) {}

      const { data: orders } = await client.from('orders').select('id,order_number,total,status,created_at').eq('user_id', session.user.id).order('created_at', { ascending:false }).limit(10);
      const ordersBox = modal.querySelector('[data-auth-orders]');
      ordersBox.innerHTML = orders?.length ? orders.map(o=>`<div class="auth-order" data-order-row="${o.id}"><strong>${o.order_number}</strong><span>${Number(o.total).toLocaleString('ar-LY')} د.ل · ${statusLabel(o.status)}</span><div class="auth-order-actions"><button type="button" class="auth-link" data-order-details="${o.id}">تفاصيل</button><button type="button" class="auth-link" data-order-reorder="${o.id}">إعادة الطلب</button></div><div class="auth-order-detail auth-hidden" data-order-detail-box="${o.id}"></div></div>`).join('') : '<p class="auth-note">ما عندكش طلبات مسجلة في الحساب حتى الآن.</p>';

      const itemsCache = {};
      const loadItems = async (orderId) => {
        if (itemsCache[orderId]) return itemsCache[orderId];
        const { data } = await client.from('order_items').select('product_name,product_code,color,size,quantity,unit_price').eq('order_id', orderId);
        itemsCache[orderId] = data || [];
        return itemsCache[orderId];
      };
      ordersBox.querySelectorAll('[data-order-details]').forEach(btn => btn.onclick = async () => {
        const box = modal.querySelector(`[data-order-detail-box="${btn.dataset.orderDetails}"]`);
        const isHidden = box.classList.contains('auth-hidden');
        if (isHidden) { const items = await loadItems(btn.dataset.orderDetails); box.innerHTML = renderOrderItemsHtml(items) || '<p class="auth-note">ما فيش تفاصيل لهذا الطلب.</p>'; }
        box.classList.toggle('auth-hidden', !isHidden);
      });
      ordersBox.querySelectorAll('[data-order-reorder]').forEach(btn => btn.onclick = async () => {
        const items = await loadItems(btn.dataset.orderReorder);
        reorderItems(items);
      });
    };

    modal.querySelector('[data-profile-save]').onclick = async () => {
      if (!currentUserId) return;
      const statusEl = modal.querySelector('[data-profile-status]');
      statusEl.textContent = 'جاري الحفظ...';
      const payload = {
        id: currentUserId,
        full_name: modal.querySelector('[data-profile-name]').value.trim(),
        phone: modal.querySelector('[data-profile-phone]').value.trim(),
        preferred_size: modal.querySelector('[data-profile-size]').value.trim(),
        marketing_opt_in: modal.querySelector('[data-profile-marketing]').checked
      };
      const { error } = await client.from('customer_profiles').upsert(payload);
      statusEl.textContent = error ? (error.message || 'تعذر الحفظ') : 'تم حفظ بياناتك ✓';
    };

    modal.querySelector('[data-address-add]').onclick = async () => {
      if (!currentUserId) return;
      const label = modal.querySelector('[data-address-label]').value.trim() || 'عنوان';
      const address = modal.querySelector('[data-address-text]').value.trim();
      if (!address) { alert('اكتب تفاصيل العنوان أولاً.'); return; }
      await client.from('customer_addresses').insert({ user_id: currentUserId, label, address });
      modal.querySelector('[data-address-label]').value = '';
      modal.querySelector('[data-address-text]').value = '';
      renderAddresses();
    };

    modal.querySelector('[data-forgot-password]').onclick = async () => {
      const email = modal.querySelector('input[name="email"]').value.trim();
      if (!email) { setStatus('اكتب إيميلك أولاً بالخانة فوق، وبعدين دوس نسيت كلمة المرور.'); return; }
      setStatus('جاري الإرسال...');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' });
      setStatus(error ? (error.message || 'تعذر الإرسال') : 'أرسلنا رابط إعادة تعيين كلمة المرور لإيميلك ✓');
    };

    const trackBtn = modal.querySelector('[data-track-submit]');
    const trackResult = modal.querySelector('[data-track-result]');
    trackBtn.onclick = async () => {
      const phone = modal.querySelector('[data-track-phone]').value.trim();
      const orderNumber = modal.querySelector('[data-track-number]').value.trim();
      if (!phone || !orderNumber) { trackResult.textContent = 'لازم تكتب رقم الهاتف ورقم الطلب.'; return; }
      trackResult.textContent = 'جاري البحث…';
      trackBtn.disabled = true;
      try {
        const r = await fetch(`/api/track-order?phone=${encodeURIComponent(phone)}&order_number=${encodeURIComponent(orderNumber)}`);
        const data = await r.json();
        if (!r.ok || !data.ok) { trackResult.textContent = data.error || 'تعذر العثور على الطلب.'; return; }
        const o = data.order;
        const itemsHtml = (o.items || []).map(it => `<div class="auth-order"><strong>${it.product_name}</strong><span>${it.product_code} · الكمية: ${it.quantity}</span></div>`).join('');
        trackResult.innerHTML = `<div class="auth-order"><strong>${o.order_number}</strong><span>الحالة: ${statusLabel(o.status)} · ${Number(o.total).toLocaleString('ar-LY')} د.ل</span></div>${itemsHtml}`;
      } catch { trackResult.textContent = 'تعذر الاتصال بالسيرفر.'; }
      finally { trackBtn.disabled = false; }
    };

    tabs.forEach(tab => tab.onclick = () => { mode = tab.dataset.authTab; tabs.forEach(x => x.classList.toggle('active', x===tab)); nameField.classList.toggle('auth-hidden', mode!=='signup'); submit.textContent = mode==='signup' ? 'إنشاء الحساب' : 'دخول'; form.querySelector('input[name="password"]').autocomplete = mode==='signup' ? 'new-password' : 'current-password'; setStatus(''); });
    button.onclick = async () => { modal.classList.add('open'); const {data:{session}} = await client.auth.getSession(); await showAccount(session); };
    modal.querySelector('.auth-close').onclick = () => modal.classList.remove('open');
    modal.onclick = e => { if(e.target===modal) modal.classList.remove('open'); };
    modal.querySelector('[data-auth-logout]').onclick = async () => { await client.auth.signOut(); await showAccount(null); setStatus('تم تسجيل الخروج.'); form.reset(); };

    form.onsubmit = async e => {
      e.preventDefault(); setStatus('جاري التنفيذ...'); submit.disabled = true;
      const fd = new FormData(form), email = String(fd.get('email')||'').trim(), password = String(fd.get('password')||''), full_name = String(fd.get('full_name')||'').trim();
      try {
        if(mode==='signup') {
          const {data,error} = await client.auth.signUp({email,password,options:{data:{full_name},emailRedirectTo:window.location.origin+'/'}});
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

    const whatsapp = document.querySelector('.whatsapp');
    if (whatsapp) {
      const key = 'veronza-whatsapp-position';
      let moved = false;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originTop = 0;
      const getSideLeft = x => x < window.innerWidth / 2 ? 0 : Math.max(0, window.innerWidth - whatsapp.offsetWidth);
      const getTop = top => Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - whatsapp.offsetHeight));
      const restore = () => {
        try {
          const saved = JSON.parse(localStorage.getItem(key) || 'null');
          if (saved && Number.isFinite(saved.top)) {
            const side = saved.side === 'right' ? 'right' : 'left';
            whatsapp.style.left = side === 'right' ? 'auto' : '0px';
            whatsapp.style.right = side === 'right' ? '0px' : 'auto';
            whatsapp.style.top = `${getTop(saved.top)}px`;
            whatsapp.style.bottom = 'auto';
          }
        } catch (_) {}
      };
      const save = () => {
        try {
          const right = parseFloat(whatsapp.style.right);
          localStorage.setItem(key, JSON.stringify({side:Number.isFinite(right) ? 'right' : 'left', top:parseFloat(whatsapp.style.top)}));
        } catch (_) {}
      };
      const move = (x, y) => {
        const side = getSideLeft(x);
        whatsapp.style.left = side === 0 ? '0px' : 'auto';
        whatsapp.style.right = side === 0 ? 'auto' : '0px';
        whatsapp.style.top = `${getTop(originTop + y - startY)}px`;
        whatsapp.style.bottom = 'auto';
      };
      const down = e => {
        const point = e.touches ? e.touches[0] : e;
        const rect = whatsapp.getBoundingClientRect();
        startX = point.clientX; startY = point.clientY; originTop = rect.top;
        dragging = true; moved = false;
      };
      const moveEvent = e => {
        if (!dragging) return;
        const point = e.touches ? e.touches[0] : e;
        if (Math.hypot(point.clientX - startX, point.clientY - startY) > 5) moved = true;
        if (moved) {
          if (e.cancelable) e.preventDefault();
          move(point.clientX, point.clientY);
        }
      };
      const up = () => { if (!dragging) return; dragging = false; if (moved) save(); };
      whatsapp.style.touchAction = 'none';
      whatsapp.addEventListener('mousedown', down);
      window.addEventListener('mousemove', moveEvent);
      window.addEventListener('mouseup', up);
      whatsapp.addEventListener('touchstart', down, {passive:false});
      window.addEventListener('touchmove', moveEvent, {passive:false});
      window.addEventListener('touchend', up);
      whatsapp.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } });
      restore();
      window.addEventListener('resize', restore);
    }
  };

  start().catch(err => console.error('Veronza auth:', err));
})();
