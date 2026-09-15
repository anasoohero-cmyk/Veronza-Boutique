(()=>{
  const toggle=document.getElementById('menuToggle');
  const menu=document.getElementById('adminMenu');
  if(!toggle||!menu)return;
  const close=()=>menu.classList.remove('open');
  const open=()=>menu.classList.add('open');
  toggle.addEventListener('click',e=>{e.stopPropagation();menu.classList.contains('open')?close():open()});
  menu.querySelectorAll('a,button').forEach(el=>el.addEventListener('click',()=>setTimeout(close,80)));
  document.addEventListener('click',e=>{if(menu.classList.contains('open')&&!menu.contains(e.target)&&e.target!==toggle)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();
