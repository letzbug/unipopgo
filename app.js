/* UniPop Go v2 — data, matching and schedule logic carried over unchanged from v72. */
const DATA_URL="https://raw.githubusercontent.com/letzbug/franks_magic/main/data/trainings.json";
const SITES_URL="https://raw.githubusercontent.com/letzbug/unipop_go_sites/main/sites.json";

const SUPABASE_URL="https://tbjlwhbwcxdvagjoonwb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_z2AUPoYHLMqxxizwKrjhwQ_tESJhSxp";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

let authProfile=null;
let authSession=null;
let authBootstrapped=false;

let trainings=[], locations={}, sitesData={schemaVersion:3,guides:[],locations:[]}, currentTrainer=null, trainerCourses=[], selectedOccurrence=null, selectedSite=null, selectedSitePersonalView=false;
let backStack=[], selectedDate=new Date(), calendarCursor=new Date();

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DAYS=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const MONTHS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const MONTHS_SHORT=["JANV.","FÉVR.","MARS","AVR.","MAI","JUIN","JUIL.","AOÛT","SEPT.","OCT.","NOV.","DÉC."];

const SCHOOL_HOLIDAY_RANGES=[
  ["01/09/2026","14/09/2026"],
  ["31/10/2026","08/11/2026"],
  ["19/12/2026","03/01/2027"],
  ["06/02/2027","14/02/2027"],
  ["27/03/2027","11/04/2027"],
  ["29/05/2027","06/06/2027"],
  ["16/07/2027","14/09/2027"]
];
const PUBLIC_HOLIDAYS=[
  "01/05/2027",
  "06/05/2027",
  "17/05/2027",
  "23/06/2027"
];

function dayStamp(d){
  return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12).getTime();
}
function calendarDayType(d){
  const stamp=dayStamp(d);
  if(PUBLIC_HOLIDAYS.some(x=>dayStamp(parseDate(x))===stamp))return "public-holiday";
  for(const [from,to] of SCHOOL_HOLIDAY_RANGES){
    if(stamp>=dayStamp(parseDate(from))&&stamp<=dayStamp(parseDate(to)))return "school-holiday";
  }
  return "";
}

function normalizeText(s=""){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function parseDate(s){if(!s)return null;const p=String(s).split("/");if(p.length!==3)return null;const[d,m,y]=p.map(Number);return new Date(y,m-1,d,12);}
function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function formatDMY(d){return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;}
function minutesFromDuration(s=""){const t=String(s).toLowerCase();let h=0,m=0,x=t.match(/(\d+)\s*h/);if(x)h=+x[1];x=t.match(/h\s*(\d+)/);if(x)m=+x[1];if(!h){x=t.match(/(\d+)\s*min/);if(x)m=+x[1];}return h*60+m;}
function addMinutes(hhmm,mins){if(!hhmm)return"";const[h,m]=hhmm.split(":").map(Number),t=h*60+m+mins;return`${String(Math.floor(t/60)%24).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;}
function teacherName(e){return `${e.prenom||""} ${e.nom||""}`.trim();}

function editDistance(a,b){
  a=normalizeText(a);b=normalizeText(b);
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const cur=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=cur;}}
  return row[b.length];
}
function allTeacherNames(){
  const map=new Map();
  trainings.forEach(c=>(c.enseignants||[]).forEach(e=>{const n=teacherName(e);if(n)map.set(normalizeText(n),n);}));
  return [...map.values()].sort((a,b)=>a.localeCompare(b,"fr"));
}
function nameScore(q,n){
  const nq=normalizeText(q),nn=normalizeText(n);
  if(!nq)return 999;if(nq===nn)return 0;if(nn.includes(nq)||nq.includes(nn))return 1;
  const bits=n.split(/\s+/);return Math.min(editDistance(nq,nn),...bits.map(x=>editDistance(nq,x)))+2;
}
function teacherMatches(q){
  return allTeacherNames().map(n=>[n,nameScore(q,n)]).filter(x=>x[1]<=Math.max(4,Math.ceil(normalizeText(q).length*.38)+1)).sort((a,b)=>a[1]-b[1]).slice(0,6).map(x=>x[0]);
}
function locationKey(c){const a=c.adresseCours||{};return normalizeText(`${a.nom||""}${a.rueNumero||""}${a.localite||""}`);}
function isRoomConfirmed(name=""){
  const n=normalizeText(name);
  return !!n && !n.includes("aconfirmer") && !n.includes("confirmer") && n!=="salle";
}
function roomCode(name=""){
  const m=String(name).trim().match(/^([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)+)/);
  return m?normalizeText(m[1]):"";
}
function courseRoomName(c,legacy={}){
  // Die offizielle Saalangabe aus trainings.json hat Priorität.
  return c.adresseCours?.salle||c.salle||c.salleNom||c.room||legacy.room||"";
}
function findRoomForCourse(site,c,legacy={}){
  if(!site)return null;
  const wanted=courseRoomName(c,legacy);
  if(!isRoomConfirmed(wanted))return null;
  const w=normalizeText(wanted);
  const wc=roomCode(wanted);

  return (site.rooms||[]).find(r=>{
    const names=[r.name,...(r.aliases||[])].filter(Boolean);
    return names.some(name=>{
      const n=normalizeText(name);
      const nc=roomCode(name);
      return n===w || n.includes(w) || w.includes(n) || (wc && nc && wc===nc);
    });
  })||null;
}
function locationData(c){
  const key=locationKey(c);
  const byCourse=locations.courses?.[normalizeText(c.code||c.reference||c.id||c.coursCode||c.coursId||"")];
  const legacy=byCourse?{...locations._default,...byCourse}:{...locations._default,...(locations.places?.[key]||{})};
  const site=findSiteForCourse(c);
  const wantedRoom=courseRoomName(c,legacy);

  if(!site){
    return {...legacy,room:isRoomConfirmed(wantedRoom)?wantedRoom:(legacy.room||"Salle à confirmer")};
  }

  const roomObj=findRoomForCourse(site,c,legacy);
  return {
    ...legacy,
    site,
    roomObj,
    phone:site.phone||"",
    access:roomObj?.directions||site.accessInfo||"",
    photos:[],
    equipment:roomObj?.equipment||[],
    room:roomObj?.name||(isRoomConfirmed(wantedRoom)?wantedRoom:"Salle à confirmer")
  };
}

/* ---- schedule (unchanged) ---- */
function scheduleRows(c){
  if(Array.isArray(c.horaires)&&c.horaires.length)return c.horaires;
  const rows=[],txt=c.horairePrevu||"",rx=/(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+à\s+(\d{1,2}:\d{2})(?:\s+\(durée\s+([^)]+)\))?/g;
  let m;while((m=rx.exec(txt)))rows.push({jour:m[1],heure:m[2],duree:m[3]||c.duree||""});
  return rows;
}
function occurrencesForCourse(c,from,to){
  const start=parseDate(c.dateDebut),end=parseDate(c.dateFin);if(!start||!end)return[];
  const lo=new Date(Math.max(start.getTime(),from.getTime())),hi=new Date(Math.min(end.getTime(),to.getTime()));if(lo>hi)return[];
  const rows=scheduleRows(c),out=[];
  if(rows.length){
    for(let d=new Date(lo);d<=hi;d.setDate(d.getDate()+1)){
      const day=DAYS[d.getDay()];
      rows.filter(r=>normalizeText(r.jour)===normalizeText(day)).forEach(r=>out.push({course:c,date:new Date(d),time:r.heure||"",duration:r.duree||c.duree||""}));
    }
  }else if(sameDay(start,end)&&start>=from&&start<=to){out.push({course:c,date:start,time:"",duration:c.duree||""});}
  return out;
}
function trainerOccurrences(from,to){return trainerCourses.flatMap(c=>occurrencesForCourse(c,from,to)).sort((a,b)=>a.date-b.date||a.time.localeCompare(b.time));}
function venueLabel(c){const a=c.adresseCours||{};return a.nom||a.localite||"Lieu à confirmer";}
function roomLabel(c){return locationData(c).room||"Salle à confirmer";}

/* ---- technical guides (unchanged) ---- */
function technicalGuideById(id){
  if(!id)return null;
  return (sitesData.guides||[]).find(g=>String(g.id)===String(id))||null;
}
function guideUrl(g){
  if(!g)return "";
  return g.path?siteAssetUrl(g.path):(g.url||"");
}
function technicalGuideForCourse(site,room){
  // A confirmed room only shows its own explicitly assigned guide/tutorial.
  // It intentionally does not inherit the lieu guide.
  if(room){
    if(room.tutorialGuidePath){
      const tut=(site?.tutorials||[]).find(t=>String(t.path||t.url)===String(room.tutorialGuidePath));
      return tut?{...tut,_isTutorialGuide:true}:{path:room.tutorialGuidePath,title:'Tutoriel'};
    }
    return technicalGuideById(room.guideId);
  }
  return technicalGuideById(site?.guideId);
}
function guideButtonHtml(g){
  const u=guideUrl(g);
  if(!g||!u)return "";
  return `<button class="btn btn-primary technical-guide-link" type="button" data-guide-url="${escapeHtml(u)}"><svg class="i"><use href="#i-tool"/></svg>Voir le guide technique</button>${g.description?`<p class="technical-guide-note">${escapeHtml(g.description)}</p>`:""}`;
}

/* ---- ICS export (unchanged) ---- */
function downloadICS(){
  const{course:c,date,time}=selectedOccurrence,a=c.adresseCours||{},row=scheduleRows(c).find(x=>x.heure===time);
  const mins=minutesFromDuration(row?.duree||c.duree||"")||60,[h,m]=(time||"09:00").split(":").map(Number),start=new Date(date.getFullYear(),date.getMonth(),date.getDate(),h,m),end=new Date(start.getTime()+mins*60000);
  const z=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}00`;
  const body=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:${z(start)}\r\nDTEND:${z(end)}\r\nSUMMARY:${c.intitule||"Cours UniPop"}\r\nLOCATION:${[a.nom,a.rueNumero,a.localite].filter(Boolean).join(", ")}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const blob=new Blob([body],{type:"text/calendar"}),u=URL.createObjectURL(blob),link=document.createElement("a");link.href=u;link.download="cours-unipop.ics";link.click();URL.revokeObjectURL(u);
}


/* ---- sites matching (unchanged) ---- */
function siteAssetUrl(path){
  if(!path)return "";
  try{return new URL(path,SITES_URL).href}catch{return path}
}
function siteAddressOneLine(site){return String(site.address||"").split(/\n+/).filter(Boolean).join(", ")}
function findSiteForCourse(c){
  if(!sitesData.locations?.length)return null;
  const venue=normalizeText(venueLabel(c));
  const a=c.adresseCours||{};
  const addr=normalizeText([a.rueNumero,a.codePostal,a.localite].filter(Boolean).join(" "));
  return sitesData.locations.find(site=>{
    const names=[site.name,...(site.aliases||[])].map(normalizeText);
    const siteAddr=normalizeText(site.address||"");
    return names.some(n=>n&&(venue.includes(n)||n.includes(venue))) || (addr&&siteAddr&&(siteAddr.includes(addr)||addr.includes(siteAddr)));
  })||null;
}
function courseIsCurrentOrFuture(c){
  const today=new Date();today.setHours(0,0,0,0);
  const end=parseDate(c.dateFin)||parseDate(c.dateDebut);
  // If the catalogue has no usable date, keep the location visible rather than hiding useful data.
  return !end || end>=today;
}
function trainerPlaceCourses(){
  const relevant=trainerCourses.filter(courseIsCurrentOrFuture);
  // If every course is historical, fall back to all trainer courses so the Lieux tab is never misleadingly empty.
  return relevant.length?relevant:trainerCourses;
}
function trainerRoomsForSite(site,courses=trainerPlaceCourses()){
  if(!site)return [];
  const seen=new Set();
  const rooms=[];
  courses.forEach(c=>{
    const courseSite=findSiteForCourse(c);
    if(!courseSite || String(courseSite.id)!==String(site.id))return;
    const room=findRoomForCourse(site,c);
    if(!room)return;
    const key=String(room.id||normalizeText(room.name||""));
    if(!key || seen.has(key))return;
    seen.add(key);
    rooms.push(room);
  });
  return rooms;
}

/* =====================================================================
   UniPop Go v2 — UI layer
   Supabase usage is identical to v72 (auth, rpc claim_trainer_access,
   select on trainer_access, edge function access-manager), but the
   profile is fetched once per user instead of on every token refresh.
   ===================================================================== */

const icon=(name,cls="i")=>`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let lastAppliedUserId=null;

/* ---------- data ---------- */
async function loadAll(){
  try{
    const [r1,r2,r3]=await Promise.all([
      fetch(DATA_URL,{cache:"no-store"}),
      fetch("data/locations.json",{cache:"no-store"}),
      fetch(SITES_URL+"?t="+Date.now(),{cache:"no-store"}).catch(()=>null)
    ]);
    if(!r1.ok)throw new Error("trainings.json");
    trainings=await r1.json();
    locations=await r2.json();
    if(r3&&r3.ok){const remote=await r3.json();if(remote&&Array.isArray(remote.locations))sitesData=remote;}
    $("#dataStatus").textContent=`${trainings.length} cours chargés`;
  }catch(err){
    console.error(err);
    $("#dataStatus").textContent="Catalogue indisponible. Vérifiez votre connexion puis rechargez la page.";
    $("#dataStatus").dataset.type="error";
  }
}

/* ---------- navigation ---------- */
function releaseIOSFocus(){
  const a=document.activeElement;
  if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))a.blur();
}
function showScreen(id,push=true){
  releaseIOSFocus();
  const active=$(".screen.active");
  if(push&&active&&active.id!==id)backStack.push(active.id);
  $$(".screen").forEach(s=>s.classList.remove("active"));
  const target=$("#"+id);
  if(target)target.classList.add("active");
  document.documentElement.dataset.screen=id;
  const navKey={detailScreen:"homeScreen",techScreen:"homeScreen",allSitesScreen:"placesScreen",placeDetailScreen:"placesScreen"}[id]||id;
  $$(".nav-item").forEach(t=>{
    const on=t.dataset.go===navKey;
    t.classList.toggle("active",on);
    if(on)t.setAttribute("aria-current","page");else t.removeAttribute("aria-current");
  });
  window.scrollTo({top:0,behavior:"instant"});
}
$$("[data-back]").forEach(b=>b.addEventListener("click",()=>showScreen(backStack.pop()||"homeScreen",false)));

function selectTrainer(name){
  const exact=allTeacherNames().find(n=>normalizeText(n)===normalizeText(name));
  if(!exact)return false;
  currentTrainer=exact;
  trainerCourses=trainings.filter(c=>(c.enseignants||[]).some(e=>normalizeText(teacherName(e))===normalizeText(exact)));
  return true;
}

/* ---------- auth (same Supabase calls as v72) ---------- */
function authMessage(msg,type="info"){
  const el=$("#authStatus");if(!el)return;
  el.textContent=msg||"";el.dataset.type=type;
}
function accountInitials(name=""){
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"UP";
}
function setAuthView(loggedIn){
  $("#authLoggedOut")?.classList.toggle("hidden",loggedIn);
  $("#authLoggedIn")?.classList.toggle("hidden",!loggedIn);
}
function setAccessEnabled(enabled){
  $("#accountCoursesButton").disabled=!enabled;
  $("#accountCalendarButton").disabled=!enabled;
  $("#accountBlocked").classList.toggle("hidden",enabled);
  document.documentElement.classList.toggle("is-guest",!enabled);
}
function setIdentity(name,initials,email){
  $("#accountTrainer").textContent=name;
  $("#accountAvatar").textContent=initials;
  $("#railName").textContent=name;
  $("#railAvatar").textContent=initials;
  $("#railEmail").textContent=email||"";
}
async function claimTrainerAccess(){
  try{await sb.rpc("claim_trainer_access");}catch(e){console.warn("claim_trainer_access",e);}
}
async function loadOwnProfile(){
  const user=authSession?.user;
  if(!user)return null;
  await claimTrainerAccess();
  const {data,error}=await sb.from("trainer_access")
    .select("id,email,trainer_name,role,active,deleted_at,auth_user_id")
    .eq("auth_user_id",user.id)
    .is("deleted_at",null)
    .maybeSingle();
  if(error)throw error;
  return data||null;
}
async function applyAuthenticatedSession(session,{openHome=false}={}){
  authSession=session||null;
  if(!session?.user){
    lastAppliedUserId=null;
    authProfile=null;currentTrainer=null;trainerCourses=[];
    setAuthView(false);setAccessEnabled(false);
    $("#accountBlocked").classList.add("hidden");
    showScreen("loginScreen",false);
    return false;
  }
  lastAppliedUserId=session.user.id;
  setAuthView(true);
  const email=session.user.email||"";
  $("#accountEmail").textContent=email;
  $("#accountStatus").textContent="Vérification de votre accès…";
  $("#accountStatus").dataset.type="info";

  try{
    authProfile=await loadOwnProfile();
    if(!authProfile){
      currentTrainer=null;trainerCourses=[];
      setIdentity("Accès non autorisé","UP",email);
      $("#accountStatus").textContent="Cette adresse e-mail n'est pas autorisée pour UniPop Go.";
      $("#accountStatus").dataset.type="error";
      setAccessEnabled(false);showScreen("loginScreen",false);
      return false;
    }
    const isAdmin=authProfile.role==="admin";
    $("#openAdminButton")?.classList.toggle("hidden",!isAdmin);

    if(authProfile.active!==true||authProfile.deleted_at){
      currentTrainer=null;trainerCourses=[];
      setIdentity(isAdmin?"Administrateur":"Accès désactivé",isAdmin?"AD":"UP",email);
      $("#accountStatus").textContent="Compte désactivé.";
      $("#accountStatus").dataset.type="error";
      setAccessEnabled(false);showScreen("loginScreen",false);
      return false;
    }
    if(isAdmin&&!authProfile.trainer_name){
      currentTrainer=null;trainerCourses=[];
      setIdentity("Administrateur UniPop Go","FG",email);
      $("#accountStatus").textContent="Accès administrateur actif.";
      $("#accountStatus").dataset.type="success";
      setAccessEnabled(false);
      $("#accountBlocked").classList.add("hidden");
      showScreen("loginScreen",false);
      return true;
    }

    const name=authProfile.trainer_name||"Formateur";
    setIdentity(name,accountInitials(name),email);

    if(!authProfile.trainer_name||!selectTrainer(authProfile.trainer_name)){
      currentTrainer=null;trainerCourses=[];
      $("#accountStatus").textContent="Le formateur lié à ce compte n'existe pas dans le catalogue actuel.";
      $("#accountStatus").dataset.type="error";
      setAccessEnabled(false);showScreen("loginScreen",false);
      return false;
    }
    setAccessEnabled(true);
    $("#accountStatus").textContent=`${trainerCourses.length} cours liés à votre profil`;
    $("#accountStatus").dataset.type="info";
    if(openHome)renderHome();
    return true;
  }catch(err){
    console.error(err);
    currentTrainer=null;trainerCourses=[];
    setIdentity("Connexion","UP",email);
    $("#accountStatus").textContent="Impossible de vérifier votre profil. Réessayez dans un instant.";
    $("#accountStatus").dataset.type="error";
    setAccessEnabled(false);showScreen("loginScreen",false);
    return false;
  }
}
function validPassword(p){return typeof p==="string"&&p.length>=8;}
async function loginWithPassword(){
  const email=$("#authEmail").value.trim();
  const password=$("#authPassword").value;
  if(!email||!password){authMessage("Entrez votre e-mail et votre mot de passe.","error");return;}
  authMessage("Connexion…");
  $("#authLoginButton").disabled=true;
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    authMessage("");
    await applyAuthenticatedSession(data.session,{openHome:true});
  }catch(err){
    console.error(err);
    authMessage("E-mail ou mot de passe incorrect.","error");
  }finally{$("#authLoginButton").disabled=false;}
}

const ACCESS_FUNCTION_URL=`${SUPABASE_URL}/functions/v1/access-manager`;
async function accessFunction(action,payload={}){
  const {data:{session}}=await sb.auth.getSession();
  const headers={"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY};
  if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
  const r=await fetch(ACCESS_FUNCTION_URL,{method:"POST",headers,body:JSON.stringify({action,...payload})});
  let body={};
  try{body=await r.json();}catch{}
  if(!r.ok||body.error)throw new Error(body.error||`Erreur ${r.status}`);
  return body;
}
async function registerFirstAccess(){
  const button=$("#registerButton"),status=$("#activationStatus");
  const show=(msg,type="error")=>{
    if(status){status.textContent=msg||"";status.dataset.type=type;}
  };
  try{
    const email=($("#registerEmail")?.value||"").trim().toLowerCase();
    const code=($("#activationCode")?.value||"").trim().toUpperCase();
    const p1=$("#registerPassword")?.value||"";
    const p2=$("#registerPassword2")?.value||"";
    if(!email){show("Entrez votre adresse e-mail.");return;}
    if(!code){show("Entrez votre code d’activation UPG-XXXX-XXXX.");return;}
    if(p1.length<8){show("Le mot de passe doit contenir au moins 8 caractères.");$("#registerPassword")?.focus();return;}
    if(p1!==p2){show("Les deux mots de passe ne correspondent pas.");$("#registerPassword2")?.focus();return;}
    if(button)button.disabled=true;
    show("Activation de votre accès…","info");
    const result=await accessFunction("activate",{email,code,password:p1});
    if(!result?.ok)throw new Error("L’activation n’a pas été confirmée.");
    show("Accès activé. Connexion…","success");
    const {data,error}=await sb.auth.signInWithPassword({email,password:p1});
    if(error)throw error;
    $("#registerPanel")?.classList.add("hidden");
    $(".auth-form")?.classList.remove("hidden");
    if(status)status.textContent="";
    authMessage("");
    await applyAuthenticatedSession(data.session,{openHome:true});
  }catch(err){
    console.error("Activation UniPop:",err);
    show(err?.message||String(err)||"Activation impossible.");
  }finally{
    if(button)button.disabled=false;
  }
}
function openCodePanel(){
  const st=$("#activationStatus");if(st)st.textContent="";
  $("#registerEmail").value=$("#authEmail").value.trim();
  $("#registerPanel").classList.remove("hidden");
  $("#recoveryPanel").classList.add("hidden");
  $(".auth-form").classList.add("hidden");
  authMessage("Demandez un nouveau code d’activation à UniPop si nécessaire.");
  $("#registerEmail").focus({preventScroll:true});
}
function closeCodePanel(){
  $("#registerPanel").classList.add("hidden");
  $(".auth-form").classList.remove("hidden");
  authMessage("");
}
async function saveRecoveryPassword(){
  authMessage("Utilisez votre code d’activation pour choisir un nouveau mot de passe.","error");
  openCodePanel();
}
async function logout(){
  await sb.auth.signOut();
  lastAppliedUserId=null;
  authProfile=null;authSession=null;currentTrainer=null;trainerCourses=[];
  setAuthView(false);setAccessEnabled(false);
  $("#accountBlocked").classList.add("hidden");
  showScreen("loginScreen",false);
}
async function initAuth(){
  // Supabase recommends not awaiting other client calls inside this callback,
  // so the work is deferred. TOKEN_REFRESHED only swaps the token: no extra
  // database request (v72 re-queried the profile every hour).
  sb.auth.onAuthStateChange((event,session)=>{
    authSession=session||null;
    if(event==="SIGNED_OUT"){setTimeout(()=>applyAuthenticatedSession(null),0);return;}
    if(event==="SIGNED_IN"||event==="USER_UPDATED"){
      const already=()=>session?.user?.id&&session.user.id===lastAppliedUserId;
      if(already())return;
      setTimeout(()=>{if(!already())applyAuthenticatedSession(session,{openHome:true});},0);
    }
  });
  const {data:{session}}=await sb.auth.getSession();
  authSession=session||null;
  await applyAuthenticatedSession(session,{openHome:!!session});
}

$("#authLoginButton")?.addEventListener("click",loginWithPassword);
$("#authPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")loginWithPassword();});
$("#authEmail")?.addEventListener("keydown",e=>{if(e.key==="Enter")$("#authPassword").focus();});
$("#showRegister")?.addEventListener("click",openCodePanel);
$("#cancelRegister")?.addEventListener("click",closeCodePanel);
$("#registerButton")?.addEventListener("click",e=>{e.preventDefault();registerFirstAccess();});
$("#registerPassword2")?.addEventListener("keydown",e=>{if(e.key==="Enter")registerFirstAccess();});
$("#forgotPassword")?.addEventListener("click",openCodePanel);
$("#saveRecoveryPassword")?.addEventListener("click",saveRecoveryPassword);
$("#openAdminButton")?.addEventListener("click",()=>{location.href="admin.html";});
$("#logoutButton")?.addEventListener("click",logout);
$("#accountCoursesButton")?.addEventListener("click",()=>{if(currentTrainer)renderHome();});
$("#accountCalendarButton")?.addEventListener("click",()=>{if(currentTrainer)openCalendar();});

/* ---------- time helpers ---------- */
function occStart(o){
  const d=new Date(o.date.getFullYear(),o.date.getMonth(),o.date.getDate());
  if(o.time){const[h,m]=o.time.split(":").map(Number);d.setHours(h||0,m||0,0,0);}
  return d;
}
function occEnd(o){
  const s=occStart(o);
  if(!o.time){const e=new Date(s);e.setHours(23,59,59);return e;}
  const mins=minutesFromDuration(o.duration)||60;
  return new Date(s.getTime()+mins*60000);
}
function occKey(o){return `${o.course.id}|${formatDMY(o.date)}|${o.time}`;}
function endTime(o){return o.time?addMinutes(o.time,minutesFromDuration(o.duration)):"";}
function countdownLabel(o,now=new Date()){
  const s=occStart(o),e=occEnd(o);
  if(now>=s&&now<e)return {text:"En cours",live:true};
  const diff=Math.round((s-now)/60000);
  if(diff<0)return {text:"Terminé",live:false};
  if(sameDay(s,now)){
    if(!o.time)return {text:"Aujourd'hui",live:true};
    if(diff<60)return {text:`Dans ${diff} min`,live:true};
    const h=Math.floor(diff/60),m=diff%60;
    return {text:`Dans ${h} h${m?" "+String(m).padStart(2,"0"):""}`,live:true};
  }
  const tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);
  if(sameDay(s,tomorrow))return {text:"Demain",live:false};
  const days=Math.round((new Date(s.getFullYear(),s.getMonth(),s.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
  return {text:`Dans ${days} jours`,live:false};
}
function longDate(d){return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;}
function holidayStamp(d){
  const t=calendarDayType(d);
  if(t==="school-holiday")return `<span class="stamp stamp-school">Congé scolaire</span>`;
  if(t==="public-holiday")return `<span class="stamp stamp-public">Jour férié</span>`;
  return "";
}

/* ---------- course rows ---------- */
function occAttrs(o){
  return `data-id="${escapeHtml(o.course.id)}" data-date="${formatDMY(o.date)}" data-time="${escapeHtml(o.time)}"`;
}
function courseRow(o,{past=false}={}){
  const c=o.course,end=endTime(o),type=calendarDayType(o.date);
  return `<button class="row occurrence${past?" is-past":""}${type?" is-"+type:""}" type="button" ${occAttrs(o)}>
    <span class="row-date"><small>${DAYS[o.date.getDay()].slice(0,3).toLowerCase()}.</small><b>${o.date.getDate()}</b><small>${MONTHS[o.date.getMonth()].slice(0,4)}${MONTHS[o.date.getMonth()].length>4?".":""}</small></span>
    <span class="row-info">
      <span class="row-time">${escapeHtml(o.time||"Horaire à confirmer")}${end?`–${escapeHtml(end)}`:""}${past?" · terminé":""}</span>
      <strong>${escapeHtml(c.intitule||"Cours")}</strong>
      <span class="row-place">${escapeHtml(venueLabel(c))} · ${escapeHtml(roomLabel(c))}</span>
      ${holidayStamp(o.date)}
    </span>
    ${icon("next","i row-chev")}
  </button>`;
}
function rowList(items,opts){return `<div class="row-list glass">${items.map(o=>courseRow(o,opts?.(o))).join("")}</div>`;}
function emptyState(text,d){
  return `<div class="empty glass">${d?holidayStamp(d):""}<p>${escapeHtml(text)}</p></div>`;
}
function bindOccurrences(){
  $$(".occurrence").forEach(el=>el.onclick=()=>{
    const course=trainerCourses.find(c=>String(c.id)===String(el.dataset.id));
    if(!course)return;
    selectedOccurrence={course,date:parseDate(el.dataset.date),time:el.dataset.time};
    renderDetail();showScreen("detailScreen");
  });
}

/* ---------- the ticket (next course) ---------- */
function ticketHtml(o){
  const c=o.course,end=endTime(o),cd=countdownLabel(o),loc=locationData(c);
  const hero=loc.site?siteAssetUrl(loc.site.heroThumb||loc.site.hero||""):"";
  return `<button class="ticket occurrence${cd.live?" is-live":""}" type="button" ${occAttrs(o)} aria-label="Prochain cours : ${escapeHtml(c.intitule||"Cours")}, ${escapeHtml(longDate(o.date))} ${escapeHtml(o.time||"")}">
    <span class="ticket-main">
      <span class="ticket-label">Prochain cours</span>
      <span class="ticket-time"><b>${escapeHtml(o.time||"--:--")}</b>${end?`<span>→ ${escapeHtml(end)}</span>`:""}</span>
      <strong class="ticket-title">${escapeHtml(c.intitule||"Cours")}</strong>
      <span class="ticket-place">${icon("pin")}<span>${escapeHtml(venueLabel(c))}<br><em>${escapeHtml(roomLabel(c))}</em></span></span>
    </span>
    <span class="ticket-stub">
      ${hero?`<img src="${escapeHtml(hero)}" alt="" loading="lazy">`:""}
      <span class="ticket-count">${escapeHtml(cd.text)}</span>
      <span class="ticket-day">${escapeHtml(longDate(o.date))}</span>
      ${holidayStamp(o.date)}
    </span>
  </button>`;
}

/* ---------- home ---------- */
function renderHome(){
  if(!currentTrainer)return;
  const first=currentTrainer.split(/\s+/)[0];
  const now=new Date();
  $("#helloName").textContent=`Bonjour ${first}`;
  $("#todayLabel").textContent=`${longDate(now)} ${now.getFullYear()}`;

  const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const todayEnd=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59);
  const futureEnd=new Date(now);futureEnd.setDate(futureEnd.getDate()+240);

  const today=trainerOccurrences(todayStart,todayEnd);
  const upcoming=trainerOccurrences(todayStart,futureEnd).filter(o=>occEnd(o)>now);
  const hero=upcoming[0]||null;
  const heroKey=hero?occKey(hero):"";

  $("#nextTicket").innerHTML=hero?ticketHtml(hero):emptyState("Aucun prochain cours trouvé.");

  const otherToday=today.filter(o=>occKey(o)!==heroKey);
  const todayType=calendarDayType(todayStart);
  let todayHtml="";
  if(otherToday.length){
    todayHtml=`<h2 class="section-title">Aujourd'hui</h2>${rowList(otherToday,o=>({past:occEnd(o)<=now}))}`;
  }else if(!today.length){
    todayHtml=`<h2 class="section-title">Aujourd'hui</h2>${emptyState("Aucun cours prévu aujourd'hui.",todayType?todayStart:null)}`;
  }
  $("#todayBlock").innerHTML=todayHtml;

  const todayKeys=new Set(today.map(occKey));
  const next=upcoming.filter(o=>occKey(o)!==heroKey&&!todayKeys.has(occKey(o))).slice(0,8);
  $("#nextCourses").innerHTML=next.length?rowList(next):emptyState("Aucun autre cours prévu pour le moment.");

  bindOccurrences();
  showScreen("homeScreen",false);
}
setInterval(()=>{
  if(document.hidden||!currentTrainer)return;
  if($("#homeScreen").classList.contains("active"))renderHome();
},60000);

/* ---------- viewer (guides + photos) ---------- */
let guideViewerObjectUrl="";
let viewerReturnFocus=null;
function openViewerShell(title,url){
  const viewer=$("#guideViewerOverlay");
  viewerReturnFocus=document.activeElement;
  $("#viewerTitle").textContent=title;
  const open=$("#viewerOpen");
  if(url){open.href=url;open.hidden=false;}else{open.hidden=true;}
  viewer.classList.remove("hidden");
  document.documentElement.classList.add("viewer-open");
  $("#guideViewerClose").focus({preventScroll:true});
  return viewer;
}
async function openGuideViewer(url){
  if(!url)return;
  openViewerShell("Guide technique",url);
  $("#guideViewerStage").classList.remove("is-photo");
  const frame=$("#guideViewerFrame"),image=$("#guideViewerImage");
  frame.hidden=true;frame.removeAttribute("srcdoc");frame.src="about:blank";
  image.hidden=true;image.removeAttribute("src");
  try{
    if(guideViewerObjectUrl){URL.revokeObjectURL(guideViewerObjectUrl);guideViewerObjectUrl="";}
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const blob=await res.blob();
    guideViewerObjectUrl=URL.createObjectURL(blob);
    const type=(blob.type||"").toLowerCase();
    const looksLikeImage=type.startsWith("image/")||/\.(png|jpe?g|webp|gif|avif|svg)(?:$|[?#])/i.test(url);
    if(looksLikeImage){
      image.onload=()=>{const st=$("#guideViewerStage");if(st){st.scrollTop=0;st.scrollLeft=0;}};
      image.src=guideViewerObjectUrl;image.alt="Guide technique";image.hidden=false;
    }else{
      frame.src=guideViewerObjectUrl;frame.hidden=false;
    }
  }catch(err){
    frame.hidden=false;frame.removeAttribute("src");
    frame.srcdoc=`<div style="font-family:system-ui;padding:24px;line-height:1.5;color:#EEF2FF;background:#0A1430;min-height:100vh;box-sizing:border-box">
      <h2 style="margin-top:0">Guide technique</h2>
      <p>Ce document ne peut pas être affiché ici. Ouvrez-le avec le bouton en haut à droite.</p></div>`;
    console.warn("Guide viewer:",err);
  }
}
function openPhoto(src,alt){
  openViewerShell(alt||"Photo",src);
  const frame=$("#guideViewerFrame"),image=$("#guideViewerImage");
  $("#guideViewerStage").classList.add("is-photo");
  frame.hidden=true;frame.src="about:blank";
  image.src=src;image.alt=alt||"Photo";image.hidden=false;
}
function closeGuideViewer(){
  const viewer=$("#guideViewerOverlay");
  if(viewer.classList.contains("hidden"))return;
  viewer.classList.add("hidden");
  const frame=$("#guideViewerFrame"),image=$("#guideViewerImage");
  frame.hidden=true;frame.removeAttribute("srcdoc");frame.src="about:blank";
  image.hidden=true;image.removeAttribute("src");
  if(guideViewerObjectUrl){URL.revokeObjectURL(guideViewerObjectUrl);guideViewerObjectUrl="";}
  document.documentElement.classList.remove("viewer-open");
  viewerReturnFocus?.focus?.({preventScroll:true});
}
$("#guideViewerClose").addEventListener("click",closeGuideViewer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeGuideViewer();});
document.addEventListener("click",e=>{
  const btn=e.target.closest?.(".technical-guide-link[data-guide-url]");
  if(btn){e.preventDefault();e.stopPropagation();openGuideViewer(btn.dataset.guideUrl);return;}
  const ph=e.target.closest?.("[data-photo]");
  if(ph){e.preventDefault();openPhoto(ph.dataset.photo,ph.dataset.alt);}
});

/* ---------- shared site fragments ---------- */
function photoTile(src,alt,cls="photo"){
  return `<button class="${cls}" type="button" data-photo="${escapeHtml(src)}" data-alt="${escapeHtml(alt)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"></button>`;
}
function accessItems(s){
  const out=[];
  if(!s)return out;
  if(s.parking)out.push({icon:"parking",title:s.parking,text:s.parkingInfo||""});
  if(s.transport)out.push({icon:"bus",title:s.transport,text:s.transportInfo||""});
  if(s.accessInfo)out.push({icon:"door",title:"Accès",text:s.accessInfo});
  if(s.pmr)out.push({icon:"access",title:"Accès PMR",text:"Accessible PMR"});
  return out;
}
function accessHtml(items){
  return items.map(a=>`<div class="access-item">${icon(a.icon)}<div><b>${escapeHtml(a.title)}</b>${a.text?`<small>${escapeHtml(a.text)}</small>`:""}</div></div>`).join("");
}
function fileLink(href,ic,label,action,external=true){
  return `<a href="${escapeHtml(href||"#")}"${external?' target="_blank" rel="noopener"':""}>${icon(ic)}<span>${escapeHtml(label)}</span><b>${escapeHtml(action)}</b></a>`;
}
function fileRows(items,ic,fallback){
  return items.map(x=>fileLink(x.path?siteAssetUrl(x.path):x.url,ic,x.title||x.name||fallback,"Ouvrir")).join("");
}
function contactRows(s){
  if(!s)return "";
  const out=[];
  if(s.website)out.push(fileLink(/^https?:\/\//i.test(s.website)?s.website:"https://"+s.website,"globe","Site web","Ouvrir"));
  if(s.phone)out.push(fileLink(`tel:${s.phone}`,"phone",s.phone,"Appeler",false));
  if(s.email)out.push(fileLink(`mailto:${s.email}`,"mail",s.email,"Écrire",false));
  return out.join("");
}
function siteHasGps(s){return !!s&&s.lat!==""&&s.lng!==""&&s.lat!=null&&s.lng!=null&&Number.isFinite(Number(s.lat))&&Number.isFinite(Number(s.lng));}
function osmUrl(lat,lng,dx=.008,dy=.005){
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng-dx}%2C${lat-dy}%2C${lng+dx}%2C${lat+dy}&layer=mapnik&marker=${lat}%2C${lng}`;
}
function roomCard(site,r,{showGuide=true}={}){
  const gallery=(r.gallery||[]).filter(g=>g.path);
  const guide=showGuide?technicalGuideForCourse(site,r):null;
  return `<article class="room glass">
    ${r.hero?photoTile(siteAssetUrl(r.hero),r.name||"Salle","room-hero"):""}
    <div class="room-body">
      <h3>${escapeHtml(r.name||"Salle")}</h3>
      ${r.floor?`<p><b>Étage</b> ${escapeHtml(r.floor)}</p>`:""}
      ${r.directions?`<p><b>Chemin</b> ${escapeHtml(r.directions)}</p>`:""}
      ${r.description?`<p>${escapeHtml(r.description)}</p>`:""}
      ${(r.equipment||[]).length?`<div class="chips">${r.equipment.map(e=>`<span>${escapeHtml(e)}</span>`).join("")}</div>`:""}
      ${guide?`<div class="room-guide">${guideButtonHtml(guide)}</div>`:""}
      ${gallery.length?`<div class="gallery gallery-sm">${gallery.map(g=>photoTile(siteAssetUrl(g.path),g.name||r.name||"Salle")).join("")}</div>`:""}
    </div>
  </article>`;
}
function block(title,inner,cls=""){return inner?`<section class="block ${cls}"><h2 class="section-title">${escapeHtml(title)}</h2>${inner}</section>`:"";}

/* ---------- course detail ---------- */
function renderDetail(){
  const{course:c,date,time}=selectedOccurrence,loc=locationData(c),site=loc.site,room=loc.roomObj,a=c.adresseCours||{};
  const row=scheduleRows(c).find(x=>x.heure===time),dur=row?.duree||c.duree||"",end=time?addMinutes(time,minutesFromDuration(dur)):"";
  const roomName=room?.name||(isRoomConfirmed(loc.room)?loc.room:"Salle à confirmer");
  const hero=site?siteAssetUrl(site.hero||site.heroThumb||""):"";
  const bg=$("#detailHeroBg");
  bg.style.backgroundImage=hero?`url("${hero.replace(/"/g,'%22')}")`:"";
  $("#detailHero").classList.toggle("has-photo",!!hero);

  const occ={course:c,date,time,duration:dur};
  const cd=countdownLabel(occ);
  $("#detailIntro").innerHTML=`
    <div class="detail-when"><b>${escapeHtml(time||"Horaire à confirmer")}</b>${end?`<span>→ ${escapeHtml(end)}</span>`:""}${cd.live?`<em class="live-pill">${escapeHtml(cd.text)}</em>`:""}</div>
    <p class="detail-date">${escapeHtml(longDate(date))} ${date.getFullYear()}</p>
    <h1>${escapeHtml(c.intitule||"Cours")}</h1>
    <p class="detail-where">${icon("pin")}<span>${escapeHtml(venueLabel(c))} · ${escapeHtml(roomName)}</span></p>
    ${holidayStamp(date)}`;

  const address=site?.address||[a.rueNumero,[a.codePostal,a.localite].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  const gallery=site?(site.gallery||[]).filter(g=>g.path):[];
  const access=accessItems(site);
  const plans=(site?.plans||[]).filter(x=>x.path||x.url),tutorials=(site?.tutorials||[]).filter(x=>x.path||x.url);
  const media=(site?.media||[]).filter(x=>x.path||x.url);
  const techGuide=technicalGuideForCourse(site,room);
  const contact=contactRows(site);
  const hasGps=siteHasGps(site);
  const map=hasGps?`<iframe class="map-frame" loading="lazy" title="Carte du lieu" src="${osmUrl(Number(site.lat),Number(site.lng))}"></iframe>`:"";

  const left=[
    `<section class="block"><h2 class="section-title">Adresse</h2><p class="address">${escapeHtml(address||"Adresse à confirmer").replace(/\n/g,"<br>")}</p>${site?.description?`<p class="prose">${escapeHtml(site.description)}</p>`:""}</section>`,
    room?block("Salle",roomCard(site,room,{showGuide:false})):block("Salle",`<div class="empty glass"><p>Salle à confirmer</p></div>`),
    techGuide?block("Guide technique",`<div class="guide-box glass">${guideButtonHtml(techGuide)}</div>`):"",
    block("Accès & transport",access.length?`<div class="access-grid">${accessHtml(access)}</div>`:""),
  ].join("");
  const right=[
    gallery.length?block("Photos du lieu",`<div class="gallery">${gallery.map(g=>photoTile(siteAssetUrl(g.path),g.name||"Photo")).join("")}</div>`):"",
    map?block("Carte",map):"",
    plans.length?block("Plans & documents",`<div class="file-list glass">${fileRows(plans,"file","Document")}</div>`):"",
    media.length?block("Médias",`<div class="file-list glass">${fileRows(media,"image","Média")}</div>`):"",
    tutorials.length?block("Tutoriels",`<div class="file-list glass">${fileRows(tutorials,"play","Tutoriel")}</div>`):"",
    contact?block("Contact",`<div class="file-list glass">${contact}</div>`):""
  ].join("");
  $("#courseSiteDetail").innerHTML=`<div class="detail-cols"><div>${left}</div><div>${right}</div></div>`;

  const query=site&&hasGps?`${site.lat},${site.lng}`:(siteAddressOneLine(site||{})||address.replace(/\n/g,", "));
  $("#routeButton").onclick=()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,"_blank");
  $("#phoneButton").disabled=!site?.phone;
  $("#phoneButton").onclick=()=>{if(site?.phone)location.href=`tel:${site.phone}`;};
  $("#icsButton").onclick=downloadICS;
}
function renderTech(loc,c){
  $("#techTitle").textContent=`Guide technique – ${roomLabel(c)}`;
  const steps=loc.tech||[];
  $("#techSteps").innerHTML=(steps.length?steps:[
    {title:"1. Allumer l'ordinateur",icon:"⏻"},{title:"2. Démarrer le projecteur",icon:"◉"},{title:"3. Sélectionner la source (HDMI)",icon:"HDMI 1"},{title:"4. Régler le son",icon:"🔊"}
  ]).map(s=>`<section class="tech-step glass"><h3>${escapeHtml(s.title)}</h3><div class="tech-image" ${s.image?`style="background-image:url('${escapeHtml(s.image)}')"`:""}>${s.image?"":escapeHtml(s.icon||"")}</div>${s.text?`<p>${escapeHtml(s.text)}</p>`:""}</section>`).join("");
}

/* ---------- calendar ---------- */
function openCalendar(){
  const now=new Date(),horizon=new Date(now);horizon.setFullYear(horizon.getFullYear()+2);
  const upcoming=trainerOccurrences(now,horizon);
  selectedDate=upcoming.length?new Date(upcoming[0].date):new Date();
  calendarCursor=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
  renderCalendar();
  showScreen("calendarScreen");
}
$("#calendarButton").onclick=openCalendar;
$("#calendarTopButton").onclick=openCalendar;
$("#prevMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar();};
$("#nextMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar();};

function renderCalendar(){
  $("#monthTitle").textContent=`${MONTHS[calendarCursor.getMonth()]} ${calendarCursor.getFullYear()}`;
  const monthStart=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);
  const gridStart=new Date(monthStart);
  gridStart.setDate(gridStart.getDate()-((gridStart.getDay()+6)%7));
  const gridEnd=new Date(gridStart);gridEnd.setDate(gridEnd.getDate()+41);
  const occ=trainerOccurrences(gridStart,gridEnd);
  const byDate=new Map();
  occ.forEach(o=>{const k=formatDMY(o.date);if(!byDate.has(k))byDate.set(k,[]);byDate.get(k).push(o);});
  const today=new Date();

  let html="";
  for(let i=0;i<42;i++){
    const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);
    const key=formatDMY(d),courses=byDate.get(key)||[],has=courses.length>0;
    const sel=sameDay(d,selectedDate),type=calendarDayType(d);
    const typeLabel=type==="school-holiday"?"congé scolaire":type==="public-holiday"?"jour férié":"";
    const hint=has?courses.map(x=>x.time||"Cours").join(", "):"";
    const cls=[d.getMonth()!==calendarCursor.getMonth()?"other":"",sel?"selected":"",has?"has-course":"",type,sameDay(d,today)?"today":""].filter(Boolean).join(" ");
    html+=`<button type="button" class="${cls}" data-date="${key}" aria-pressed="${sel}" aria-label="${d.getDate()} ${MONTHS[d.getMonth()]}${typeLabel?`, ${typeLabel}`:""}${has?`, cours ${hint}`:""}" title="${[typeLabel,has?`Cours : ${hint}`:""].filter(Boolean).join(" · ")}">
      <span class="day-number">${d.getDate()}</span>${has?`<span class="course-marker">${courses.length>1?courses.length:""}</span>`:""}
    </button>`;
  }
  $("#calendarGrid").innerHTML=html;
  $$("#calendarGrid button").forEach(b=>b.onclick=()=>{
    selectedDate=parseDate(b.dataset.date);
    calendarCursor=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
    renderCalendar();
    if(window.innerWidth<960)$("#selectedDayTitle").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});
  });

  const day=byDate.get(formatDMY(selectedDate))||trainerOccurrences(
    new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate()),
    new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate(),23,59,59));
  $("#selectedDayTitle").textContent=`Cours du ${selectedDate.getDate()} ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
  $("#selectedDayCourses").innerHTML=day.length?rowList(day):emptyState("Aucun cours ce jour-là.",calendarDayType(selectedDate)?selectedDate:null);

  const futureStart=new Date(selectedDate.getTime()+86400000);
  const futureEnd=new Date(selectedDate);futureEnd.setFullYear(futureEnd.getFullYear()+2);
  const other=trainerOccurrences(futureStart,futureEnd).slice(0,6);
  $("#calendarOtherCourses").innerHTML=other.length?rowList(other):emptyState("Aucun autre cours trouvé.");
  bindOccurrences();
}

/* ---------- places ---------- */
const bySiteName=(a,b)=>String(a.name||"").localeCompare(String(b.name||""),"fr",{sensitivity:"base",numeric:true});
function siteCard(site,rooms,personal){
  const thumb=site.heroThumb||site.hero;
  const count=rooms.length?`${rooms.length} salle${rooms.length>1?"s":""}`:"Salle à confirmer";
  return `<button class="site-card dynamic-place" type="button" data-site-id="${escapeHtml(site.id)}" data-personal="${personal?1:0}">
    <span class="site-photo">${thumb?`<img src="${escapeHtml(siteAssetUrl(thumb))}" alt="" loading="lazy">`:icon("building","i site-ph")}</span>
    <span class="site-text">
      <strong>${escapeHtml(site.name||"Lieu")}</strong>
      <span class="site-addr">${escapeHtml(siteAddressOneLine(site))}</span>
      <span class="site-meta"><span class="chip-sm">${escapeHtml(count)}</span>${site.pmr?`<span class="chip-sm">PMR</span>`:""}</span>
    </span>
    ${icon("next","i row-chev")}
  </button>`;
}
function renderPlaces(){
  if(!currentTrainer){$("#placesList").innerHTML=emptyState("Connectez-vous pour voir vos lieux.");return;}
  const courses=trainerPlaceCourses();
  const matched=new Map(),unmatched=new Map();
  courses.forEach(c=>{
    const site=findSiteForCourse(c);
    if(site&&site.active!==false)matched.set(String(site.id),site);
    else{const k=locationKey(c)||normalizeText(venueLabel(c));if(k)unmatched.set(k,c);}
  });
  const cards=[...matched.values()].sort(bySiteName).map(s=>siteCard(s,trainerRoomsForSite(s,courses),true));
  const fallback=[...unmatched.values()].map(c=>{
    const a=c.adresseCours||{},loc=locationData(c);
    return `<div class="site-card is-static">
      <span class="site-photo">${icon("building","i site-ph")}</span>
      <span class="site-text">
        <strong>${escapeHtml(venueLabel(c))}</strong>
        <span class="site-addr">${escapeHtml([a.rueNumero,a.codePostal,a.localite].filter(Boolean).join(", "))}</span>
        <span class="site-meta"><span class="chip-sm">${escapeHtml(roomLabel(c))}</span></span>
        <span class="site-note">${escapeHtml(loc.access||"Informations du lieu bientôt disponibles.")}</span>
      </span>
    </div>`;
  });
  $("#placesList").innerHTML=[...cards,...fallback].join("")||emptyState("Aucun lieu trouvé pour vos cours.");
  bindSiteCards("#placesList");
}
function renderAllSites(){
  const all=(sitesData.locations||[]).filter(s=>s&&s.active!==false).sort(bySiteName);
  $("#allSitesList").innerHTML=all.length?all.map(s=>siteCard(s,s.rooms||[],false)).join(""):emptyState("Aucun autre site disponible pour le moment.");
  bindSiteCards("#allSitesList");
}
function bindSiteCards(host){
  $$(`${host} .dynamic-place`).forEach(el=>el.onclick=()=>openSite(el.dataset.siteId,el.dataset.personal==="1"));
}
$("#allSitesButton")?.addEventListener("click",()=>{renderAllSites();showScreen("allSitesScreen");});
function openSite(id,personalView=false){
  selectedSite=(sitesData.locations||[]).find(x=>String(x.id)===String(id));
  selectedSitePersonalView=!!personalView;
  if(!selectedSite)return;
  renderSiteDetail();showScreen("placeDetailScreen");
}
function renderSiteDetail(){
  const s=selectedSite;if(!s)return;
  $("#placeDetailTopTitle").textContent=s.name||"Lieu";
  $("#placeName").textContent=s.name||"";
  $("#placeAddress").innerHTML=escapeHtml(s.address||"").replace(/\n/g,"<br>");
  const hero=siteAssetUrl(s.hero||s.heroThumb||"");
  const heroImg=$("#placeHero");
  if(hero){heroImg.src=hero;heroImg.alt=s.name||"";heroImg.classList.remove("hidden");}
  else{heroImg.removeAttribute("src");heroImg.classList.add("hidden");}
  $(".place-hero").classList.toggle("has-photo",!!hero);
  $("#placeDescription").textContent=s.description||"";
  $("#placeDescription").classList.toggle("hidden",!s.description);

  const hasGps=siteHasGps(s),lat=Number(s.lat),lng=Number(s.lng);
  const query=hasGps?`${lat},${lng}`:siteAddressOneLine(s);
  $("#placeGoogleMaps").onclick=()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,"_blank");
  $("#placeAppleMaps").onclick=()=>window.open(`https://maps.apple.com/?q=${encodeURIComponent(s.name||"")}${hasGps?`&ll=${lat},${lng}`:""}`,"_blank");

  const access=accessItems(s);
  $("#placeAccessCards").innerHTML=accessHtml(access)||`<div class="empty glass"><p>Informations d'accès à compléter.</p></div>`;

  const gallery=[...(s.gallery||[]),...(s.media||[]).filter(m=>m.type?.startsWith("image/"))].filter(x=>x.path);
  $("#placeGallery").innerHTML=gallery.map(g=>photoTile(siteAssetUrl(g.path),g.name||"Photo")).join("");
  $("#placeGallerySection").classList.toggle("hidden",!gallery.length);

  const rooms=selectedSitePersonalView?trainerRoomsForSite(s):(s.rooms||[]);
  $("#placeRooms").innerHTML=rooms.map(r=>roomCard(s,r)).join("");
  $("#placeRoomsSection").classList.toggle("hidden",!rooms.length);

  const siteGuide=technicalGuideById(s.guideId);
  const gh=$("#placeGuideSection");
  gh.innerHTML=siteGuide?`<h2 class="section-title">Guide technique</h2><div class="guide-box glass">${guideButtonHtml(siteGuide)}</div>`:"";
  gh.classList.toggle("hidden",!siteGuide);

  const plans=(s.plans||[]).filter(p=>p.path||p.url);
  $("#placePlans").innerHTML=fileRows(plans,"file","Plan / document");
  $("#placePlans").classList.add("glass");
  $("#placePlansSection").classList.toggle("hidden",!plans.length);

  const media=(s.media||[]).filter(m=>!m.type?.startsWith("image/")&&(m.path||m.url));
  $("#placeMedia").innerHTML=fileRows(media,"image","Média");
  $("#placeMedia").classList.add("glass");
  $("#placeMediaSection").classList.toggle("hidden",!media.length);

  const tutorials=s.tutorials||[];
  $("#placeTutorials").innerHTML=fileRows(tutorials,"play","Tutoriel");
  $("#placeTutorials").classList.add("glass");
  $("#placeTutorialsSection").classList.toggle("hidden",!tutorials.length);

  const contact=contactRows(s);
  $("#placeContact").innerHTML=contact;
  $("#placeContact").classList.add("glass");
  $("#placeContactSection").classList.toggle("hidden",!contact);

  if(hasGps){$("#placeMapFrame").src=osmUrl(lat,lng,.01,.006);$("#placeMapSection").classList.remove("hidden");}
  else{$("#placeMapFrame").removeAttribute("src");$("#placeMapSection").classList.add("hidden");}
}

/* ---------- tabs ---------- */
$$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
  const id=btn.dataset.go;
  if(id==="loginScreen"){showScreen("loginScreen",false);return;}
  if(!authProfile?.active||!currentTrainer){showScreen("loginScreen",false);return;}
  if(id==="homeScreen")renderHome();
  else if(id==="calendarScreen")openCalendar();
  else if(id==="placesScreen"){renderPlaces();showScreen("placesScreen");}
}));

/* ---------- start ---------- */
async function bootstrap(){
  showScreen("loginScreen",false);
  await loadAll();
  await initAuth();
  authBootstrapped=true;
  document.documentElement.classList.add("is-ready");
}
bootstrap();
