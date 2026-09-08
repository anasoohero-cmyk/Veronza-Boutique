const products=[
 {id:1,name:'شنطة Veronza الفاخرة',price:450,type:'bags',img:'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85',rating:'4.9',reviews:12},
 {id:2,name:'حذاء Veronza الأنيق',price:365,type:'shoes',img:'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=85',rating:'4.8',reviews:20},
 {id:3,name:'سيت كامل — شنطة + حذاء',price:699,type:'set',img:'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85',extraImg:'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=85',rating:'5.0',reviews:8}
];
let cart=JSON.parse(localStorage.getItem('veronza-cart')||'[]');
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
function money(n){return `${n.toLocaleString('ar-LY')} د.ل`}
function productVisual(p){return p.extraImg?`<div class="set-visual"><img src="${p.img}" alt="${p.name} — الشنطة" loading="lazy"><img src="${p.extraImg}" alt="${p.name} — الحذاء" loading="lazy"></div>`:`<img src="${p.img}" alt="${p.name}" loading="lazy">`}
function renderProducts(list=products){
 const grid=$('#productGrid'); if(!grid)return;
 grid.innerHTML=list.map(p=>`<article class="product"><div class="product-img">${productVisual(p)}<button class="heart" aria-label="إضافة للمفضلة">♡</button>${p.type==='set'?'<span class="set-badge">سيت كامل</span>':''}</div><div class="product-info"><div class="product-name">${p.name}</div><div class="price">${money(p.price)}</div><div class="stars">★★★★★ <span>(${p.reviews})</span></div><button class="add" data-add="${p.id}">أضف إلى السلة　♧</button></div></article>`).join('');
 $$('[data-add]').forEach(b=>b.addEventListener('click',()=>addToCart(Number(b.dataset.add))));
}
function save(){localStorage.setItem('veronza-cart',JSON.stringify(cart));}
function addToCart(id){const p=products.find(x=>x.id===id);const item=cart.find(x=>x.id===id);item?item.qty++:cart.push({...p,qty:1});save();renderCart();openCart();}
function renderCart(){
 const box=$('[data-cart-items]'), count=cart.reduce((s,x)=>s+x.qty,0), total=cart.reduce((s,x)=>s+x.price*x.qty,0); $('[data-cart-total]').textContent=money(total); $('.bag span').textContent=count;
 box.innerHTML=cart.length?cart.map(x=>`<div class="cart-row" style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><img src="${x.img}" style="width:64px;height:64px;object-fit:cover;background:#f5f2ed"><div style="flex:1"><strong style="font-size:12px">${x.name}</strong><div style="font-size:11px;color:#777">${money(x.price)} × ${x.qty}</div></div><button data-remove="${x.id}" style="border:0;background:none;font-size:20px">×</button></div>`).join(''):'<p style="color:#888;text-align:center">السلة فارغة حالياً.</p>';
 $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==Number(b.dataset.remove));save();renderCart()});
}
function openLayer(el){el.classList.add('open');$('.overlay').classList.add('show')}
function closeLayers(){$$('.mobile-menu,.search-panel,.cart-drawer').forEach(x=>x.classList.remove('open'));$('.overlay').classList.remove('show')}
function openCart(){closeLayers();openLayer($('[data-cart-drawer]'))}
$('[data-menu]').onclick=()=>openLayer($('[data-mobile-menu]'));
$('[data-menu-close]').onclick=closeLayers;
$('[data-overlay]').onclick=closeLayers;
$('[data-cart]').onclick=openCart;
$('[data-cart-close]').onclick=closeLayers;
$('[data-search]').onclick=()=>{openLayer($('[data-search-panel]'));setTimeout(()=>$('#searchInput').focus(),250)};
$('[data-search-close]').onclick=closeLayers;
$('#searchInput').addEventListener('input',e=>{const q=e.target.value.trim();const results=$('#searchResults');if(!q){results.innerHTML='';return}const matches=products.filter(p=>p.name.includes(q));results.innerHTML=matches.length?matches.map(p=>`<div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #eee"><img src="${p.img}" style="width:55px;height:55px;object-fit:cover"><div><strong>${p.name}</strong><div>${money(p.price)}</div></div></div>`).join(''):'<p>لا توجد نتائج مطابقة.</p>'});
$$('.tabs button').forEach(btn=>btn.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');const text=btn.textContent.trim();renderProducts(text==='الكل'?products:text==='الأحذية'?products.filter(p=>p.type==='shoes'):text==='الشنط'?products.filter(p=>p.type==='bags'):products.filter(p=>p.type==='set'));});
$('[data-newsletter]').onsubmit=e=>{e.preventDefault();e.currentTarget.innerHTML='<strong>تم الاشتراك بنجاح ✓</strong><p>سنرسل لك أحدث العروض أولاً.</p>'};
$('[data-checkout]').onclick=()=>alert(cart.length?'سيتم تجهيز صفحة إتمام الطلب في المرحلة التالية.':'أضف منتجاً إلى السلة أولاً.');
renderProducts();renderCart();
