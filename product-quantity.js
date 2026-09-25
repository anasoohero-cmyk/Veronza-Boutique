(() => {
  const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
  const PRODUCT_LOAD_TIMEOUT = 10000;
  let supabaseClientPromise;
  async function loadSupabaseClient() {
    if (supabaseClientPromise) return supabaseClientPromise;
    supabaseClientPromise = new Promise((resolve, reject) => {
      let settled = false,
        timer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const create = () =>
        window.supabase?.createClient
          ? finish(resolve, window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY))
          : finish(reject, new Error('تعذر تهيئة Supabase'));
      timer = setTimeout(
        () => finish(reject, new Error('انتهت مهلة تحميل Supabase')),
        PRODUCT_LOAD_TIMEOUT,
      );
      if (window.supabase?.createClient) {
        create();
        return;
      }
      const existing = document.querySelector('script[data-supabase-js]');
      if (existing) {
        existing.addEventListener('load', create, { once: true });
        existing.addEventListener('error', () => finish(reject, new Error('تعذر تحميل Supabase')), {
          once: true,
        });
        return;
      }
      const script = document.createElement('script');
      script.src = 'vendor-supabase.js';
      script.dataset.supabaseJs = 'true';
      script.onload = create;
      script.onerror = () => finish(reject, new Error('تعذر تحميل Supabase'));
      document.head.appendChild(script);
    }).catch((error) => {
      supabaseClientPromise = null;
      throw error;
    });
    return supabaseClientPromise;
  }
  async function syncQuantity() {
    try {
      const client = await loadSupabaseClient();
      const { data, error } = await client
        .from('products')
        .select('id,quantity')
        .eq('is_active', true)
        .order('id', { ascending: true });
      if (error) throw error;
      const quantities = new Map(
        (Array.isArray(data) ? data : []).map((row) => [Number(row.id), Number(row.quantity || 0)]),
      );
      if (Array.isArray(window.products))
        window.products.forEach((p) => {
          if (quantities.has(Number(p.id))) p.quantity = quantities.get(Number(p.id));
        });
    } catch (error) {
      console.error('Veronza product quantity:', error);
    }
  }
  let tries = 0;
  const wait = () => {
    if (Array.isArray(window.products) && window.products.length) {
      syncQuantity();
      return;
    }
    if (tries++ < 40) setTimeout(wait, 250);
  };
  wait();
})();
