const SUPABASE_URL='https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY='sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let orders=[],filter='all',selected=null;
const $=s=>document.querySelector(s);
const statusNames={pending:'قيد المراجعة',confirmed:'تم التأكيد',preparing:'قيد التجهيز',shipped:'تم الشحن',delivered:'تم التسليم',cancelled:'ملغي',returned:'مرتجع'};
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(t){const x=$('#toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2600)}
function showApp(session){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#adminEmail').textContent=session.user.email||''}
function showLogin(){ $('#appView').classList.add('hidden');$('#loginView').classList.remove('hidden') }
async function isAdmin(user){const {data,error}=await sb.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();return !error&&!!data}
async function load(){
  const {data,error}=await sb.from('orders').select('id,order_number,user_id,customer_name,customer_phone,customer_address,total,status,created_at,updated_at,whatsapp_status,whatsapp_last_error,whatsapp_sent_at').order('created_at',{ascending:false});
  if(error){toast('تعذر تحميل الطلبات: '+error.message);return}
  orders=data||[];render();$('#lastUpdated').textContent='آخر تحديث '+new Date().toLocaleTimeString('ar-LY',{hour:'2-digit',minute:'2-digit'});
}
function renderStats(){const c=s=>orders.filter(o=>o.status===s).length;$('#stats').innerHTML=[['كل الطلبات',orders.length],['جديدة',c('pending')],['قيد التجهيز',c('preparing')],['قيد الشحن',c('shipped')],['تم التسليم',c('delivered')]].map(x=>`<div class="stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('')}
function render(){renderStats();const list=filter==='all'?orders:orders.filter(o=>o.status===filter);const box=$('#orders');if(!list.length){box.innerHTML='<div class="empty">لا توجد طلبات في هذا القسم حالياً.</div>';return}box.innerHTML=list.map(o=>`<div class="order-row"><div class="order-number">${esc(o.order_number)}</div><div class="customer"><b>${esc(o.customer_name)}</b><small>${esc(o.customer_phone)}</small></div><div class="amount">${Number(o.total||0).toLocaleString('ar-LY')} د.ل</div><div><span class="status ${esc(o.status)}">${statusNames[o.status]||esc(o.status)}</span></div><div class="date">${new Date(o.created_at).toLocaleString('ar-LY')}</div><button class="details-btn" data-open="${o.id}">التفاصيل</button></div>`).join('')}
async function openOrder(id){
  selected=orders.find(o=>o.id===id);if(!selected)return;
  const {data:items,error}=await sb.from('order_items').select('id,product_code,product_name,color,size,quantity,unit_price,image_url,created_at').eq('order_id',id).order('created_at');
  if(error){toast('تعذر تحميل تفاصيل الطلب');return}
  selected.items=items||[];
  $('#orderDetails').innerHTML=`<div class="detail-title"><span class="eyebrow">VERONZA ORDER</span><h2>${esc(selected.order_number)}</h2><p>${new Date(selected.created_at).toLocaleString('ar-LY')} · WhatsApp: ${esc(selected.whatsapp_status||'pending')}</p></div>
  <div class="customer-box"><h3>بيانات الزبون</h3><div class="customer-grid"><div class="field"><b>الاسم</b><span>${esc(selected.customer_name)}</span></div><div class="field"><b>الهاتف</b><span>${esc(selected.customer_phone)}</span></div><div class="field" style="grid-column:1/-1"><b>العنوان</b><span>${esc(selected.customer_address)}</span></div></div><div class="contact-actions"><a href="tel:${esc(selected.customer_phone)}">اتصال بالزبون</a><a target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(selected.customer_phone.replace(/\D/g,''))}">WhatsApp</a></div></div>
  <div class="items-box"><h3>المنتجات</h3>${selected.items.map(i=>`<div class="item">${i.image_url?`<img src="${esc(i.image_url)}" alt="">`:'<div></div>'}<div><div class="item-name">${esc(i.product_name)}</div><div class="item-meta">الكود: ${esc(i.product_code)} · اللون: ${esc(i.color||'—')} · المقاس: ${esc(i.size||'—')} · الكمية: ${esc(i.quantity)}</div></div><div class="item-price">${Number(i.unit_price||0).toLocaleString('ar-LY')} د.ل</div></div>`).join('')||'<div class="empty">لا توجد منتجات.</div>'}<div style="display:flex;justify-content:space-between;margin-top:12px;font-weight:800"><span>الإجمالي</span><span>${Number(selected.total||0).toLocaleString('ar-LY')} د.ل</span></div></div>
  <div class="actions-box"><h3>إدارة الطلب</h3><div class="detail-actions"><select id="orderStatus">${Object.entries(statusNames).map(([k,v])=>`<option value="${k}" ${selected.status===k?'selected':''}>${v}</option>`).join('')}</select><div></div><textarea id="adminNote" placeholder="ملاحظات الأدمن"></textarea><button class="save-status" id="saveOrder">حفظ حالة الطلب</button></div></div>`;
  $('#orderModal').classList.remove('hidden');
  $('#saveOrder').onclick=saveOrder;
}
async function saveOrder(){const status=$('#orderStatus').value;const {data,error}=await sb.from('orders').update({status,updated_at:new Date().toISOString()}).eq('id',selected.id).select().single();if(error){toast('فشل تحديث الحالة: '+error.message);return}selected={...selected,...data};const idx=orders.findIndex(o=>o.id===data.id);if(idx>=0)orders[idx]=data;render();$('#orderModal').classList.add('hidden');toast('تم تحديث حالة الطلب')}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const {data,error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){$('#loginError').textContent=error.message;return}if(!(await isAdmin(data.user))){await sb.auth.signOut();$('#loginError').textContent='هذا الحساب ليس حساب الأدمن.';return}showApp(data.session);load()});
$('#logoutBtn').onclick=async()=>{await sb.auth.signOut();showLogin()};
$('#refreshBtn').onclick=load;
$('.filters').addEventListener('click',e=>{const b=e.target.closest('[data-status]');if(!b)return;filter=b.dataset.status;document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x===b));render()});
$('#orders').addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(b)openOrder(b.dataset.open)});
$('#closeModal').onclick=()=>$('#orderModal').classList.add('hidden');
$('#orderModal').addEventListener('click',e=>{if(e.target.id==='orderModal')e.currentTarget.classList.add('hidden')});
(async()=>{const {data:{session}}=await sb.auth.getSession();if(session&&await isAdmin(session.user)){showApp(session);load()}else if(session)await sb.auth.signOut()})();
setInterval(()=>{if(!$('#appView').classList.contains('hidden'))load()},30000);
