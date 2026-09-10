(()=>{
  const SUPABASE_URL='https://kahbxvbirsjmednkybse.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
  const loadClient=()=>new Promise((resolve,reject)=>{
    const make=()=>window.supabase?.createClient?resolve(window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY)):reject(new Error('تعذر تهيئة Supabase'));
    if(window.supabase?.createClient){make();return}
    const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=make;s.onerror=()=>reject(new Error('تعذر تحميل Supabase'));document.head.appendChild(s);
  });
  const getCart=()=>{try{const v=JSON.parse(localStorage.getItem('veronza-cart')||'[]');return Array.isArray(v)?v:[]}catch{return[]}};
  const sameItem=(a,b)=>Number(a?.id)===Number(b?.id)&&String(a?.color??'')===String(b?.color??'')&&String(a?.size??'')===String(b?.size??'');
  const stockFor=id=>{const p=(window.products||[]).find(x=>Number(x.id)===Number(id));return p?Math.max(0,Number(p.quantity)||0):null};
  const cartQtyFor=(item,cart=getCart())=>cart.filter(x=>sameItem(x,item)).reduce((s,x)=>s+Math.max(0,Number(x.qty)||0),0);
  const stockMessage=(available,requested)=>alert(`الكمية المطلوبة غير متوفرة. المتوفر حالياً: ${available} قطعة.`);
  function guardAddButton(e){
    const b=e.target.closest('[data-add]');
    if(!b)return;
    const id=Number(b.dataset.add),stock=stockFor(id);
    if(stock===null)return;
    const p=(window.products||[]).find(x=>Number(x.id)===id);
    const color=document.querySelector(`[data-color="${id}"]`)?.value||'';
    const size=document.querySelector(`[data-size="${id}"]`)?.value||'';
    const item={id,color,size};
    const current=cartQtyFor(item);
    if(stock<=current){e.preventDefault();e.stopImmediatePropagation();stockMessage(stock,1);return}
  }
  function guardCartPlus(e){
    const b=e.target.closest('[data-qty][data-dir="1"]');
    if(!b)return;
    const cart=getCart(),i=Number(b.dataset.qty),item=cart[i];
    if(!item)return;
    const stock=stockFor(item.id);
    if(stock===null)return;
    const current=cartQtyFor(item,cart);
    if(current>=stock){e.preventDefault();e.stopImmediatePropagation();stockMessage(stock,1);return}
  }
  function guardDetailPlus(e){
    const b=e.target.closest('[data-detail-plus]');
    if(!b)return;
    const modal=document.querySelector('#productDetailsModal');
    const id=Number(modal?.dataset.productId),stock=stockFor(id);
    if(!modal||stock===null)return;
    const q=Number(modal.querySelector('[data-detail-qty]')?.textContent)||1;
    const color=modal.querySelector('[data-detail-color]')?.value||'';
    const size=modal.querySelector('[data-detail-size]')?.value||'';
    const current=cartQtyFor({id,color,size});
    if(current+q>=stock){e.preventDefault();e.stopImmediatePropagation();stockMessage(stock,1);return}
  }
  function guardDetailAdd(e){
    const b=e.target.closest('[data-detail-add]');
    if(!b)return;
    const modal=document.querySelector('#productDetailsModal');
    const id=Number(modal?.dataset.productId),stock=stockFor(id);
    if(!modal||stock===null)return;
    const q=Number(modal.querySelector('[data-detail-qty]')?.textContent)||1;
    const color=modal.querySelector('[data-detail-color]')?.value||'';
    const size=modal.querySelector('[data-detail-size]')?.value||'';
    const current=cartQtyFor({id,color,size});
    if(stock<=0||current+q>stock){e.preventDefault();e.stopImmediatePropagation();stockMessage(stock, q);return}
  }
  function guardCheckout(e){
    const form=e.target.closest('[data-checkout-form]');
    if(!form)return;
    const cart=getCart();
    for(const item of cart){
      const stock=stockFor(item.id);
      if(stock!==null&&Math.max(0,Number(item.qty)||0)>stock){e.preventDefault();e.stopImmediatePropagation();stockMessage(stock,item.qty);return}
    }
  }
  document.addEventListener('click',guardAddButton,true);
  document.addEventListener('click',guardCartPlus,true);
  document.addEventListener('click',guardDetailPlus,true);
  document.addEventListener('click',guardDetailAdd,true);
  document.addEventListener('submit',guardCheckout,true);
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
