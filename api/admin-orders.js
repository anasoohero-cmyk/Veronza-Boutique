const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_TOKEN=process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID=process.env.META_PHONE_NUMBER_ID;
const STATUS_LABELS={pending:'قيد المراجعة',confirmed:'تم التأكيد',preparing:'قيد التجهيز',shipped:'جاري التوصيل',delivered:'تم التسليم',cancelled:'ملغي',returned:'مرتجع'};
function allowedOrigin(req){const o=req.headers.origin;if(!o)return '';try{return new URL(o).host===req.headers.host?o:''}catch{return ''}}
function corsHeaders(req){const h={'Access-Control-Allow-Methods':'GET,PATCH,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Vary':'Origin'};const origin=allowedOrigin(req);if(origin)h['Access-Control-Allow-Origin']=origin;return h}
function json(req,res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');const origin=allowedOrigin(req);if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}res.end(JSON.stringify(body))}
async function sbFetch(path,options={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}return {ok:r.ok,status:r.status,data}}
async function requireAdmin(req){const auth=req.headers.authorization||'';if(!auth.startsWith('Bearer '))return null;const token=auth.slice(7);const u=await sbFetch('/auth/v1/user',{headers:{Authorization:`Bearer ${token}`,apikey:SERVICE_KEY}});if(!u.ok||!u.data?.id)return null;const a=await sbFetch(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(u.data.id)}&limit=1`);if(!a.ok||!Array.isArray(a.data)||!a.data.length)return null;return u.data}
function normalizeLibyanPhone(raw){let p=String(raw||'').replace(/[^\d+]/g,'');if(p.startsWith('+'))p=p.slice(1);if(p.startsWith('00'))p=p.slice(2);if(p.startsWith('0'))p='218'+p.slice(1);if(!p.startsWith('218')&&p.length===9)p='218'+p;return p}
async function notifyCustomerStatusChange(order,newStatus){
  if(!META_TOKEN||!META_PHONE_NUMBER_ID)return{sent:false,error:'WhatsApp not configured'};
  const to=normalizeLibyanPhone(order.customer_phone);
  if(!to)return{sent:false,error:'Invalid customer phone'};
  const templatePayload={messaging_product:'whatsapp',to,type:'template',template:{name:'veronza_order_status_update',language:{code:'ar'},components:[{type:'body',parameters:[{type:'text',text:order.customer_name||'عميلنا العزيز'},{type:'text',text:order.order_number},{type:'text',text:STATUS_LABELS[newStatus]||newStatus}]}]}};
  try{
    const r=await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(META_PHONE_NUMBER_ID)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(templatePayload)});
    if(!r.ok)return{sent:false,error:(await r.text()).slice(0,500)};
    return{sent:true};
  }catch(e){return{sent:false,error:String(e?.message||e).slice(0,500)}}
}
module.exports=async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req));res.end();return}
 if(!SUPABASE_URL||!SERVICE_KEY)return json(req,res,500,{error:'Server configuration is incomplete'});const user=await requireAdmin(req);if(!user)return json(req,res,401,{error:'Unauthorized'});
 if(req.method==='GET'){const q=new URL(req.url,'http://veronza.local').searchParams;const id=q.get('order_id');if(id){const r=await sbFetch(`/rest/v1/order_items?select=id,product_code,product_name,color,size,quantity,unit_price,image_url,created_at&order_id=eq.${encodeURIComponent(id)}&order=created_at.asc`);if(!r.ok)return json(req,res,502,{error:'Could not load order items'});return json(req,res,200,{items:r.data})}const r=await sbFetch('/rest/v1/orders?select=id,order_number,user_id,customer_name,customer_phone,customer_address,total,status,admin_notes,created_at,updated_at,whatsapp_status,whatsapp_last_error,whatsapp_sent_at&order=created_at.desc');if(!r.ok)return json(req,res,502,{error:'Could not load orders'});return json(req,res,200,{orders:r.data})}
 if(req.method==='PATCH'){let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body)}catch{return json(req,res,400,{error:'Invalid JSON'})}}const allowed=['pending','confirmed','preparing','shipped','delivered','cancelled','returned'];if(!body.id||!allowed.includes(body.status))return json(req,res,400,{error:'Invalid order or status'});
  const existing=await sbFetch(`/rest/v1/orders?select=id,order_number,customer_name,customer_phone,status&id=eq.${encodeURIComponent(body.id)}&limit=1`);
  const previousOrder=existing.ok&&Array.isArray(existing.data)?existing.data[0]:null;
  const adminNotes=body.admin_notes==null?null:String(body.admin_notes);const r=await sbFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(body.id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:body.status,admin_notes:adminNotes,updated_at:new Date().toISOString()})});if(!r.ok)return json(req,res,502,{error:'Could not update order'});
  const updatedOrder=Array.isArray(r.data)?r.data[0]:r.data;
  let notify=null;
  if(previousOrder&&previousOrder.status!==body.status){notify=await notifyCustomerStatusChange(updatedOrder,body.status);if(!notify.sent)console.error('Status WhatsApp notify failed:',notify.error)}
  return json(req,res,200,{order:updatedOrder,notify})}
 res.setHeader('Allow','GET,PATCH');return json(req,res,405,{error:'Method not allowed'})};
