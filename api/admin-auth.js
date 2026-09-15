const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
function allowedOrigin(req){const o=req.headers.origin;if(!o)return '';try{return new URL(o).host===req.headers.host?o:''}catch{return ''}}
function corsHeaders(req){const h={'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Vary':'Origin'};const origin=allowedOrigin(req);if(origin)h['Access-Control-Allow-Origin']=origin;return h}
function json(req,res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');const origin=allowedOrigin(req);if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}res.end(JSON.stringify(body))}
module.exports=async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req));res.end();return}
  if(req.method!=='GET')return json(req,res,405,{ok:false,error:'Method not allowed'});
  if(!SUPABASE_URL||!SERVICE_KEY)return json(req,res,500,{error:'Server configuration incomplete'});
  const auth=req.headers.authorization||'';
  if(!/^Bearer\s+/i.test(auth))return json(req,res,401,{ok:false,error:'Authentication required'});
  const token=auth.replace(/^Bearer\s+/i,'').trim();
  const headers={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
  try{
    const uResp=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||SERVICE_KEY,Authorization:`Bearer ${token}`}});
    if(!uResp.ok)return json(req,res,401,{ok:false,error:'Invalid session'});
    const user=await uResp.json();
    if(!user?.id)return json(req,res,401,{ok:false,error:'Invalid session'});
    const aResp=await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{headers});
    const aText=await aResp.text();
    let aData; try{aData=aText?JSON.parse(aText):null}catch{aData=aText}
    if(!aResp.ok||!Array.isArray(aData)||!aData.length)return json(req,res,403,{ok:false,error:'Admin access required',debug_status:aResp.status,debug_body:aData});
    return json(req,res,200,{ok:true,user:{id:user.id,email:user.email||''}});
  }catch(e){return json(req,res,401,{ok:false,error:'Invalid session',debug_message:String(e && e.message || e)})}
};
