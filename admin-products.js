const SUPABASE_URL='https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY='sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let products=[];
let selectedImageDataUrls=[];
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const typeNames={shoes:'حذاء',bags:'شنطة',set:'Set'};

function toast(t){
  const x=$('#toast');
  x.textContent=t;
  x.classList.add('show');
  setTimeout(()=>x.classList.remove('show'),2500)
}

function showApp(session){
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent=session.user.email||'';
  load()
}

function showLogin(){
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden')
}

async function requireAdmin(userId){
  const {data,error}=await sb.from('admin_users').select('user_id').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  return !!data
}

async function load(){
  const {data,error}=await sb.from('products').select('id,code,name,price,type,img,extra_img,rating,reviews,colors,sizes,size_quantities,is_active,quantity,created_at,updated_at').order('id',{ascending:false});
  if(error){
    console.error(error);
    return
  }
  products=Array.isArray(data)?data:[];
  render()
}

function render(){
  const q=$('#search').value.trim().toLowerCase();
  const list=products.filter(p=>!q||String(p.name).toLowerCase().includes(q)||String(p.code).toLowerCase().includes(q));
  const box=$('#products');
  if(!box)return;
  box.innerHTML=list.map(p=>`<div class="product-row"><img class="thumb" src="${esc(p.img)}" alt=""><div class="product-main"><h3>${esc(p.name)}</h3><div class="meta">الكود: ${esc(p.code)} · النوع: ${typeNames[p.type]||esc(p.type)} · الكمية: ${Number(p.quantity||0)}<br>الألوان: ${esc((p.colors||[]).join('، ')||'—')} · المقاسات: ${esc((p.sizes||[]).join('، ')||'—')}</div></div><div class="price">${Number(p.price||0).toLocaleString('ar-LY')} د.ل</div><span class="badge ${p.is_active?'on':'off'}">${p.is_active?'متوفر':'غير متوفر'}</span><div class="row-actions"><button data-edit="${p.id}">تعديل</button><button class="danger" data-delete="${p.id}">حذف</button></div></div>`).join('')
}

function resetForm(){
  ['productId','name','code','price','img','colors','sizes'].forEach(id=>$('#'+id).value='');
  $('#code').readOnly=true;
  $('#code').required=false;
  $('#quantity').value='0';
  $('#type').value='shoes';
  $('#extraImgs').value='';
  $('#isActive').checked=true;
  $('#sizeOptions').innerHTML='';
  $('#sizeQuantities').innerHTML='';
  $('#preview').innerHTML='';
  selectedImageDataUrls=[]
}

function openModal(p){
  if(!p){
    resetForm();
    renderSizeOptions();
    $('#modalTitle').textContent='إضافة منتج'
  }else{
    $('#productId').value=p.id;
    $('#name').value=p.name||'';
    $('#code').value=p.code||'';
    $('#code').readOnly=true;
    $('#code').required=false;
    $('#price').value=p.price||'';
    $('#type').value=p.type||'shoes';
    $('#img').value=p.img||'';
    $('#extraImgs').value=p.extra_img||'';
    $('#colors').value=(Array.isArray(p.colors)?p.colors:[]).join(', ');
    $('#isActive').checked=p.is_active!==false;
    const sizes=Array.isArray(p.sizes)?p.sizes:[];
    $('#sizes').value=sizes.join(', ');
    renderSizeOptions(sizes,p.size_quantities||{});
    renderSizeQuantities(p.size_quantities||{});
    $('#modalTitle').textContent='تعديل المنتج';
    preview()
  }
  $('#modal').classList.remove('hidden')
}

function closeModal(){
  $('#modal').classList.add('hidden')
}

function csv(v){
  return String(v||'').split(',').map(x=>x.trim()).filter(Boolean)
}

function preview(){
  const urls=selectedImageDataUrls.length?selectedImageDataUrls:[$('#img').value.trim(),...$('#extraImgs').value.split(/\n+/).map(x=>x.trim()).filter(Boolean)];
  $('#preview').innerHTML=urls.map(url=>`<img src="${url}" alt="معاينة" style="max-width:100%;max-height:200px;border-radius:8px;margin:8px 0">`).join('')
}

function imageFileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('تعذر قراءة الصورة'));
    reader.onload=()=>{
      const result=reader.result;
      if(typeof result==='string'){
        resolve(result)
      }else{
        reject(new Error('نتيجة غير متوقعة'))
      }
    }
  })
}

async function handleImageFile(e){
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  const invalid=files.find(file=>!file.type.startsWith('image/'));
  if(invalid){
    $('#formError').textContent='جميع الملفات يجب أن تكون صور.';
    return
  }
  try{
    selectedImageDataUrls=await Promise.all(files.map(f=>imageFileToDataUrl(f)));
    preview()
  }catch(error){
    $('#formError').textContent=error.message||'تعذر معالجة الصور'
  }
}

function renderSizeOptions(selected=[],existing={}){
  const box=$('#sizeOptions');
  if(!box)return;
  const required=$('#type').value==='shoes'||$('#type').value==='set';
  if(!required){
    box.innerHTML='';
    return
  }
  const commonSizes=['36','37','38','39','40','41','42','43','44','45','46','47'];
  box.innerHTML=commonSizes.map(size=>`<label><input type="checkbox" class="size-option" value="${size}" ${selected.includes(size)?'checked':''}>${size}<span class="size-quantity-wrap">الكمية: <input type="number" class="size-quantity" data-size="${size}" value="${existing[size]||0}" min="0"></span></label>`).join('')
}

function syncSelectedSizes(){
  const selected=[...document.querySelectorAll('.size-option:checked')].map(input=>input.value);
  $('#sizes').value=selected.join(', ')
}

function updateSizesRequired(){
  const required=$('#type').value==='shoes'||$('#type').value==='set';
  $('#sizes').required=required;
  $('#sizes').closest('label').classList.toggle('required',required);
  renderSizeOptions([],{})
}

function renderSizeQuantities(existing={}){
  document.querySelectorAll('.size-quantity').forEach(input=>{
    const size=input.dataset.size;
    input.value=existing[size]||0
  })
}

function syncTotalQuantity(){
  const inputs=[...document.querySelectorAll('.size-quantity')];
  if(!inputs.length)return;
  const total=inputs.filter(input=>input.closest('label')?.querySelector('.size-option')?.checked).reduce((sum,input)=>sum+Math.max(0,Math.floor(Number(input.value||0))),0);
  $('#quantity').value=total
}

function getSizeQuantities(){
  const result={};
  document.querySelectorAll('.size-quantity').forEach(input=>{
    const checked=input.closest('label')?.querySelector('.size-option')?.checked;
    if(checked)result[input.dataset.size]=Math.max(0,Math.floor(Number(input.value||0)))
  });
  return result
}

async function save(e){
  e.preventDefault();
  $('#formError').textContent='';
  const id=$('#productId').value;
  const sizes=csv($('#sizes').value);
  const isSized=$('#type').value==='shoes'||$('#type').value==='set';

  if(isSized&&!sizes.length){
    $('#formError').textContent='المقاسات مطلوبة للحذاء والـ Set.';
    return
  }

  if(isSized){
    const missing=[...document.querySelectorAll('.size-option:checked')].some(option=>{
      const input=option.closest('label')?.querySelector('.size-quantity');
      return !input||input.value===''
    });
    if(missing){
      $('#formError').textContent='حدد كمية لكل مقاس.';
      return
    }
  }

  if(!id){
    const {data,error}=await sb.rpc('next_product_code');
    if(error){
      $('#formError').textContent='تعذر توليد كود المنتج: '+error.message;
      return
    }
    $('#code').value=String(data);
    $('#code').required=true
  }

  const sizeQuantities=isSized?getSizeQuantities():{};

  const payload={
    name:$('#name').value.trim(),
    code:$('#code').value.trim(),
    price:Number($('#price').value||0),
    type:$('#type').value,
    img:$('#img').value.trim(),
    extra_img:$('#extraImgs').value.split(/\n+/).map(x=>x.trim()).filter(Boolean).join('\n')||null,
    colors:csv($('#colors').value),
    sizes,
    size_quantities:sizeQuantities,
    quantity:isSized?Object.values(sizeQuantities).reduce((a,b)=>a+b,0):Math.max(0,Math.floor(Number($('#quantity').value||0))),
    is_active:$('#isActive').checked,
    updated_at:new Date().toISOString()
  };

  if(!payload.name||!payload.code||!payload.img){
    $('#formError').textContent='الاسم والكود والصورة الرئيسية مطلوبة.';
    return
  }

  try{
    let result;
    if(id)
      result=await sb.from('products').update(payload).eq('id',id).select().single();
    else
      result=await sb.from('products').insert(payload).select().single();

    if(result.error)throw result.error;

    closeModal();
    toast(id?'تم تعديل المنتج':'تمت إضافة المنتج');
    await load()
  }catch(error){
    $('#formError').textContent=error.message||'تعذر حفظ المنتج'
  }
}

async function remove(id){
  const p=products.find(x=>Number(x.id)===Number(id));
  if(!p)return;
  if(!confirm(`حذف المنتج «${p.name}» نهائياً؟\nإذا كنت تبي توقف ظهوره فقط، عدّله وأطفل الحالة.`))return;

  try{
    const {error}=await sb.from('products').delete().eq('id',id);
    if(error)throw error;
    toast('تم حذف المنتج');
    await load()
  }catch(error){
    alert('تعذر حذف المنتج: '+error.message)
  }
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('#loginError').textContent='';
  const {data,error}=await sb.auth.signInWithPassword({
    email:$('#email').value.trim(),
    password:$('#password').value
  });

  if(error){
    $('#loginError').textContent=error.message;
    return
  }

  const {data:{session}}=await sb.auth.getSession();
  if(!session)return;

  try{
    if(await requireAdmin(session.user.id))
      showApp(session);
    else{
      await sb.auth.signOut();
      $('#loginError').textContent='أنت لا تملك صلاحيات الإدارة.'
    }
  }catch{
    await sb.auth.signOut();
    $('#loginError').textContent='تعذر التحقق من الصلاحيات'
  }
});

(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return;
  try{
    if(await requireAdmin(session.user.id))
      showApp(session);
    else
      await sb.auth.signOut()
  }catch{
    await sb.auth.signOut()
  }
})();

$('#logoutBtn').onclick=async()=>{
  await sb.auth.signOut();
  showLogin()
};

$('#refreshBtn').onclick=load;
$('#addBtn').onclick=()=>openModal();
$('#cancelBtn').onclick=closeModal;
$('#closeModal').onclick=closeModal;
$('#search').addEventListener('input',render);

$('#type').addEventListener('change',()=>{
  updateSizesRequired();
  renderSizeQuantities()
});

$('#sizes').addEventListener('input',()=>{
  syncSelectedSizes();
  renderSizeQuantities();
  syncTotalQuantity()
});

document.addEventListener('change',e=>{
  if(e.target.classList.contains('size-option')){
    syncSelectedSizes();
    syncTotalQuantity()
  }
  if(e.target.classList.contains('size-quantity')){
    syncTotalQuantity()
  }
});

$('#products').addEventListener('click',e=>{
  const editBtn=e.target.closest('[data-edit]');
  if(editBtn){
    const p=products.find(x=>Number(x.id)===Number(editBtn.dataset.edit));
    if(p)openModal(p);
    return
  }
  const deleteBtn=e.target.closest('[data-delete]');
  if(deleteBtn){
    remove(deleteBtn.dataset.delete)
  }
});

$('#productForm').addEventListener('submit',save);
$('#imgButton').addEventListener('click',()=>$('#imgFile').click());
$('#imgFile').addEventListener('change',handleImageFile);
