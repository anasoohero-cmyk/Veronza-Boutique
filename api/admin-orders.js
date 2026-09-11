const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body))}
async function sbFetch(path,options={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}return {ok:r.ok,status:r.status,data}}
async function requireAdmin(req){
  const auth=req.headers.authorization||'';if(!auth.startsWith('Bearer '))return null;
  const token=auth.slice(7);
  const u=await sbFetch('/auth/v1/user',{headers:{Authorization:`Bearer ${token}`,apikey:SERVICE_KEY}});
  if(!u.ok||!u.data?.id)return null;
  const a=await sbFetch(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(u.data.id)}&limit=1`);
  if(!a.ok||!Array.isArray(a.data)||!a.data.length)return null;
  return u.data;
}
module.exports=async(req,res)=>{
  if(!SUPABASE_URL||!SERVICE_KEY)return json(res,500,{error:'Server configuration is incomplete'});
  const user=await requireAdmin(req);if(!user)return json(res,401,{error:'Unauthorized'});
  if(req.method==='GET'){
    const r=await sbFetch('/rest/v1/orders?select=id,order_number,user_id,customer_name,customer_phone,customer_address,total,status,created_at,updated_at,whatsapp_status,whatsapp_last_error,whatsapp_sent_at&order=created_at.desc');
    if(!r.ok)return json(res,502,{error:'Could not load orders'});return json(res,200,{orders:r.data});
  }
  if(req.method==='PATCH'){
    let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body)}catch{return json(res,400,{error:'Invalid JSON'})}}
    const allowed=['pending','confirmed','preparing','shipped','delivered','cancelled'];
    if(!body.id||!allowed.includes(body.status))return json(res,400,{error:'Invalid order or status'});
    const r=await sbFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(body.id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:body.status,updated_at:new Date().toISOString()})});
    if(!r.ok)return json(res,502,{error:'Could not update order'});return json(res,200,{order:Array.isArray(r.data)?r.data[0]:r.data});
  }
  res.setHeader('Allow','GET,PATCH');return json(res,405,{error:'Method not allowed'});
};
