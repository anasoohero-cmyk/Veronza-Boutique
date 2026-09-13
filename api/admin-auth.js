const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};
function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');res.end(JSON.stringify(body))}
module.exports=async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders);res.end();return}
  if(req.method!=='GET')return json(res,405,{ok:false,error:'Method not allowed'});
  if(!SUPABASE_URL||!SERVICE_KEY)return json(res,500,{error:'Server configuration incomplete'});
  const auth=req.headers.authorization||'';
  if(!/^Bearer\s+/i.test(auth))return json(res,401,{ok:false,error:'Authentication required'});
  const token=auth.replace(/^Bearer\s+/i,'').trim();
  const headers={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
  try{
    const uResp=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||SERVICE_KEY,Authorization:`Bearer ${token}`}});
    if(!uResp.ok)return json(res,401,{ok:false,error:'Invalid session'});
    const user=await uResp.json();
    if(!user?.id)return json(res,401,{ok:false,error:'Invalid session'});
    const aResp=await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{headers});
    if(!aResp.ok||!(await aResp.json()).length)return json(res,403,{ok:false,error:'Admin access required'});
    return json(res,200,{ok:true,user:{id:user.id,email:user.email||''}});
  }catch(_){return json(res,401,{ok:false,error:'Invalid session'})}
};
