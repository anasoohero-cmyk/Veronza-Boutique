(()=>{
  const SUPABASE_URL='https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
  const loadClient=()=>new Promise((resolve,reject)=>{
    const make=()=>window.supabase?.createClient?resolve(window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY)):reject(new Error('تعذر تهيئة Supabase'));
    if(window.supabase?.createClient){make();return}
    const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=make;s.onerror=()=>reject(new Error('تعذر تحميل Supabase'));document.head.appendChild(s);
  });
  async function syncQuantity(){
    try{
      const client=await loadClient();
      const {data,error}=await client.from('products').select('id,quantity').order('id',{ascending:true});
      if(error)throw error;
      const rows=Array.isArray(data)?data:[];
      const byId=new Map(rows.map(r=>[Number(r.id),Number(r.quantity||0)]));
      if(!Array.isArray(window.products))return;
      window.products.forEach(p=>{p.quantity=byId.get(Number(p.id))??0});
      if(typeof renderProducts==='function')renderProducts(window.products);
    }catch(error){console.error('Veronza product quantity:',error)}
  }
  let tries=0;
  const wait=()=>{
    if(Array.isArray(window.products)&&window.products.length){syncQuantity();return}
    if(tries++<80)setTimeout(wait,250);
  };
  wait();
})();
