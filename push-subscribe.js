const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};
module.exports = async (req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders);res.end();return}
  if(req.method!=='POST'&&req.method!=='DELETE')return res.status(405).json({ok:false,error:'Method not allowed'});
  const supabaseUrl=process.env.SUPABASE_URL, serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceKey)return res.status(500).json({ok:false,error:'Server configuration incomplete'});
  const auth=req.headers.authorization||''; if(!/^Bearer\s+/i.test(auth))return res.status(401).json({ok:false,error:'Authentication required'});
  const token=auth.replace(/^Bearer\s+/i,'').trim();
  let user=null; try{const r=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||serviceKey,Authorization:`Bearer ${token}`}});if(!r.ok)return res.status(401).json({ok:false,error:'Invalid session'});user=await r.json()}catch(_){return res.status(401).json({ok:false,error:'Invalid session'})}
  const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
  const adminResp=await fetch(`${supabaseUrl}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{headers});
  if(!adminResp.ok||!(await adminResp.json()).length)return res.status(403).json({ok:false,error:'Admin access required'});
  if(req.method==='DELETE'){
    const endpoint=String(req.body?.endpoint||'').trim(); if(!endpoint)return res.status(400).json({ok:false,error:'Endpoint required'});
    await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?admin_user_id=eq.${encodeURIComponent(user.id)}&endpoint=eq.${encodeURIComponent(endpoint)}`,{method:'DELETE',headers});
    return res.status(200).json({ok:true});
  }
  const sub=req.body; if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return res.status(400).json({ok:false,error:'Invalid subscription'});
  const r=await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`,{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({admin_user_id:user.id,endpoint:sub.endpoint,subscription:sub,updated_at:new Date().toISOString()})});
  if(!r.ok)return res.status(500).json({ok:false,error:'Could not save subscription'}); return res.status(200).json({ok:true});
};
