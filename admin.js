const SUPABASE_URL="https://tbjlwhbwcxdvagjoonwb.supabase.co";
const KEY="sb_publishable_z2AUPoYHLMqxxizwKrjhwQ_tESJhSxp";
const DATA="https://raw.githubusercontent.com/letzbug/franks_magic/ee1deb187cb56360699bb18606d7685de65d9e6c/data/trainings.json";

let sb=null, users=[], names=[], currentAdmin=null, lastCreatedCode="", currentPage=1, pageSize=20;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
let toastTimer=null;
function toast(msg,ms=3200){
  const el=$("#toast");if(!el)return alert(msg);
  el.textContent=msg;el.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),ms);
}
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");

function gateStatus(msg="",error=false){
  const el=$("#gateStatus"); if(!el)return;
  el.textContent=msg; el.className="status"+(error?" error":"");
}
function createStatus(msg="",type=""){
  const el=$("#createStatus"); if(!el)return;
  el.textContent=msg; el.className="status"+(type?` ${type}`:"");
}
async function fn(action,payload={}){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(`${SUPABASE_URL}/functions/v1/access-manager`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":KEY,
      "Authorization":`Bearer ${session?.access_token||""}`
    },
    body:JSON.stringify({action,...payload})
  });
  let body={}; try{body=await r.json()}catch{}
  if(!r.ok||body.error)throw Error(body.error||`Erreur ${r.status}`);
  return body;
}
async function trainerNames(){
  const r=await fetch(DATA,{cache:"no-store"});
  if(!r.ok)throw Error(`Trainings JSON: ${r.status}`);
  const d=await r.json(),m=new Map();
  d.forEach(c=>(c.enseignants||[]).forEach(e=>{
    const n=`${e.prenom||""} ${e.nom||""}`.trim();
    if(n)m.set(norm(n),n);
  }));
  names=[...m.values()].sort((a,b)=>a.localeCompare(b,"fr"));
  $("#names").innerHTML=names.map(n=>`<option value="${esc(n)}">`).join("");
}
async function adminProfile(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return null;
  const {data,error}=await sb.from("trainer_access")
    .select("id,email,trainer_name,role,active,deleted_at,auth_user_id")
    .eq("auth_user_id",session.user.id)
    .is("deleted_at",null).maybeSingle();
  if(error)throw error;
  if(!data||data.role!=="admin"||data.active!==true)return null;
  return data;
}
async function boot(){
  try{
    currentAdmin=await adminProfile();
    const ok=!!currentAdmin;
    $("#gate").classList.toggle("hidden",ok);
    $("#app").classList.toggle("hidden",!ok);
    $("#logout").classList.toggle("hidden",!ok);
    if(ok){
      gateStatus("");
      $("#adminIdentity").textContent=`${currentAdmin.trainer_name||"Administrateur UniPop Go"} · ${currentAdmin.email}`;
      await trainerNames();
      await load();
    }
  }catch(e){
    console.error(e); gateStatus(`Erreur: ${e.message}`,true);
  }
}
async function login(){
  const email=$("#email").value.trim(),password=$("#password").value;
  if(!email||!password){gateStatus("E-mail et mot de passe obligatoires.",true);return}
  $("#login").disabled=true; gateStatus("Connexion…");
  try{
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    currentAdmin=await adminProfile();
    if(!currentAdmin){await sb.auth.signOut();throw Error("Ce compte n’a pas les droits administrateur.")}
    await boot();
  }catch(e){console.error(e);gateStatus(e.message||"Connexion impossible.",true)}
  finally{$("#login").disabled=false}
}
async function createAccess(){
  let role=$("#role").value,email=$("#trainerEmail").value.trim().toLowerCase(),name=$("#trainer").value.trim();
  $("#createdCode").classList.add("hidden"); createStatus("");
  if(!email){createStatus("E-mail obligatoire.","error");return}
  if(role==="trainer"){
    name=names.find(n=>norm(n)===norm(name));
    if(!name){createStatus("Choisissez un formateur présent dans le catalogue.","error");return}
  }else name=null;
  $("#create").disabled=true;
  try{
    const b=await fn("authorize",{email,trainer_name:name,role});
    lastCreatedCode=b.code||"";
    $("#createdCodeValue").textContent=lastCreatedCode;
    $("#createdCode").classList.toggle("hidden",!lastCreatedCode);
    createStatus(role==="admin"?"Accès administrateur prêt.":"Accès formateur prêt. Transmettez le code d’activation.","success");
    $("#trainer").value="";$("#trainerEmail").value="";
    currentPage=1;
    await load();
  }catch(e){createStatus(e.message,"error")}
  finally{$("#create").disabled=false}
}
function render(){
  const q=$("#search").value.trim().toLowerCase(),filter=$("#roleFilter").value;

  const filtered=users.filter(u=>{
    const matchesQ=!q
      ||String(u.trainer_name||"Administrateur UniPop Go").toLowerCase().includes(q)
      ||String(u.email||"").toLowerCase().includes(q);
    const matchesRole=filter==="all"
      ||(filter==="blocked"?!u.active:u.role===filter);
    return matchesQ&&matchesRole;
  });

  const trainers=users.filter(u=>u.role==="trainer").length;
  const admins=users.filter(u=>u.role==="admin").length;
  $("#count").textContent=`${users.length} accès · ${trainers} formateurs · ${admins} administrateur(s)`;

  const total=filtered.length;
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  if(currentPage>totalPages)currentPage=totalPages;
  if(currentPage<1)currentPage=1;

  const startIndex=(currentPage-1)*pageSize;
  const endIndex=Math.min(startIndex+pageSize,total);
  const shown=filtered.slice(startIndex,endIndex);

  $("#list").innerHTML=shown.map(u=>{
    const self=u.auth_user_id&&u.auth_user_id===currentAdmin?.auth_user_id;
    const label=u.trainer_name||"Administrateur UniPop Go";
    const initials=label.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
    return `<article class="row${u.active?"":" is-blocked"}" data-id="${esc(u.id)}">
      <span class="avatar">${esc(initials)}</span>
      <div class="who">
        <strong>${esc(label)}</strong>
        <span>${esc(u.email)}</span>
        <div class="badges">
          <span class="badge ${u.active?"ok":"blocked"}">${u.active?"Actif":"Bloqué"}</span>
          <span class="badge">${u.role==="admin"?"Administrateur":"Formateur"}</span>
          ${u.activation_code?'<span class="badge pending">Code en attente</span>':""}
          ${self?'<span class="badge">Votre compte</span>':""}
        </div>
      </div>
      <div class="actions">
        ${u.activation_code?'<button class="code-btn" data-a="copy">Copier code</button>':""}
        <button data-a="reset">Nouveau code</button>
        ${self?"":`<button data-a="toggle">${u.active?"Bloquer":"Réactiver"}</button>`}
        ${self?"":'<button class="danger" data-a="delete">Supprimer</button>'}
      </div>
    </article>`;
  }).join("")||'<p class="empty">Aucun accès ne correspond à cette recherche.</p>';

  document.querySelectorAll(".row button").forEach(b=>
    b.addEventListener("click",()=>act(b.closest(".row").dataset.id,b.dataset.a))
  );

  const pager=$("#pager");
  pager.classList.toggle("hidden",total<=pageSize);

  $("#pagerInfo").textContent=total
    ? `${startIndex+1}–${endIndex} sur ${total}`
    : "0 résultat";

  $("#prevPage").disabled=currentPage<=1;
  $("#nextPage").disabled=currentPage>=totalPages;

  const numbers=$("#pageNumbers");
  const pages=[];
  const addPage=n=>pages.push(`<button class="${n===currentPage?"active":""}" data-page="${n}">${n}</button>`);
  const addDots=()=>pages.push('<span class="dots">…</span>');

  if(totalPages<=7){
    for(let i=1;i<=totalPages;i++)addPage(i);
  }else{
    addPage(1);
    if(currentPage>4)addDots();
    const from=Math.max(2,currentPage-1);
    const to=Math.min(totalPages-1,currentPage+1);
    for(let i=from;i<=to;i++)addPage(i);
    if(currentPage<totalPages-3)addDots();
    addPage(totalPages);
  }
  numbers.innerHTML=pages.join("");
  numbers.querySelectorAll("button[data-page]").forEach(b=>
    b.addEventListener("click",()=>{
      currentPage=Number(b.dataset.page)||1;
      render();
      document.querySelector("#list")?.scrollIntoView({behavior:"smooth",block:"start"});
    })
  );
}
async function load(){
  const {data,error}=await sb.from("trainer_access")
    .select("id,email,trainer_name,role,active,activation_code,deleted_at,auth_user_id")
    .is("deleted_at",null).order("trainer_name",{ascending:true,nullsFirst:true});
  if(error)throw error; users=data||[]; render();
}
async function act(id,action){
  const u=users.find(x=>x.id===id); if(!u)return;
  const self=!!(u.auth_user_id&&u.auth_user_id===currentAdmin?.auth_user_id);
  try{
    if(action==="copy"){
      await navigator.clipboard.writeText(u.activation_code);
      toast(`Code copié : ${u.activation_code}`); return;
    }
    if((action==="toggle"||action==="delete")&&self){
      toast("Le compte administrateur connecté ne peut pas être bloqué ou supprimé.");return;
    }
    if(action==="reset"){
      const b=await fn("reset_code",{id});
      let copied=false;
      if(b.code){copied=await navigator.clipboard.writeText(b.code).then(()=>true).catch(()=>false);}
      alert(`Nouveau code d’activation : ${b.code}${copied?"\n\n(Copié dans le presse-papiers.)":""}`);
    }
    if(action==="toggle")await fn("set_active",{id,active:!u.active});
    if(action==="delete"&&confirm(`Supprimer l’accès de ${u.trainer_name||u.email} ?`))await fn("archive",{id});
    await load();
  }catch(e){toast(e.message,6000)}
}

document.addEventListener("DOMContentLoaded",async()=>{
  try{
    if(!window.supabase?.createClient)throw Error("La bibliothèque Supabase n’a pas pu être chargée.");
    sb=window.supabase.createClient(SUPABASE_URL,KEY);
    $("#login").addEventListener("click",login);
    $("#password").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
    $("#email").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
    $("#logout").addEventListener("click",async()=>{await sb.auth.signOut();currentAdmin=null;await boot()});
    $("#refresh").addEventListener("click",load);
    $("#create").addEventListener("click",createAccess);
    $("#copyCreatedCode").addEventListener("click",async()=>{
      if(!lastCreatedCode)return;
      await navigator.clipboard.writeText(lastCreatedCode);
      createStatus("Code copié.","success");
    });
    $("#role").addEventListener("change",()=>{
      const admin=$("#role").value==="admin";
      $("#trainerField").classList.toggle("hidden",admin);
      if(admin)$("#trainer").value="";
    });
    $("#search").addEventListener("input",()=>{currentPage=1;render();});
    $("#roleFilter").addEventListener("change",()=>{currentPage=1;render();});
    $("#pageSize").addEventListener("change",()=>{
      pageSize=Number($("#pageSize").value)||20;
      currentPage=1;
      render();
    });
    $("#prevPage").addEventListener("click",()=>{
      if(currentPage>1){currentPage--;render();document.querySelector("#list")?.scrollIntoView({behavior:"smooth",block:"start"});}
    });
    $("#nextPage").addEventListener("click",()=>{
      const q=$("#search").value.trim().toLowerCase(),filter=$("#roleFilter").value;
      const total=users.filter(u=>{
        const matchesQ=!q||String(u.trainer_name||"Administrateur UniPop Go").toLowerCase().includes(q)||String(u.email||"").toLowerCase().includes(q);
        const matchesRole=filter==="all"||(filter==="blocked"?!u.active:u.role===filter);
        return matchesQ&&matchesRole;
      }).length;
      const totalPages=Math.max(1,Math.ceil(total/pageSize));
      if(currentPage<totalPages){currentPage++;render();document.querySelector("#list")?.scrollIntoView({behavior:"smooth",block:"start"});}
    });
    await boot();
  }catch(e){
    console.error(e);gateStatus(`Erreur de démarrage: ${e.message}`,true);
  }
});