/* UniPop Go v2 service worker.
   Own cache prefix ("unipop-go2-") so it never touches the caches of the
   old app (which only clears "unipop-formateur-*"), and vice versa. */
const VERSION="2.0.0";
const PREFIX="unipop-go2-";
const CACHE=PREFIX+VERSION;
const CORE=[
  "./","./index.html","./style.css?v=2.0.0","./app.js?v=2.0.0",
  "./manifest.webmanifest","./data/locations.json",
  "./assets/icon.svg","./assets/icon-180.png","./assets/icon-192.png","./assets/skyline.webp"
];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
});
self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

const networkFirst=req=>fetch(req,{cache:"no-store"})
  .then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;})
  .catch(()=>caches.match(req,{ignoreSearch:false}).then(m=>m||caches.match(req,{ignoreSearch:true})));

self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET")return;                       // Supabase POSTs etc. go straight to the network
  const url=new URL(req.url);
  if(url.hostname.endsWith("supabase.co"))return;     // never cache auth/database traffic

  if(req.mode==="navigate"){
    e.respondWith(fetch(req,{cache:"no-store"}).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put("./index.html",copy));return r;
    }).catch(()=>caches.match("./index.html")));
    return;
  }
  // catalogue, sites.json and site photos: fresh when online, cached when offline
  if(url.hostname==="raw.githubusercontent.com"){e.respondWith(networkFirst(req));return;}
  // own code: always try fresh first so updates land immediately
  if(url.origin===self.location.origin&&/\.(js|css|json|webmanifest)$/.test(url.pathname)){
    e.respondWith(networkFirst(req));return;
  }
  // fonts + supabase-js library: cache first
  if(url.hostname==="fonts.gstatic.com"||url.hostname==="fonts.googleapis.com"||url.hostname==="cdn.jsdelivr.net"){
    e.respondWith(caches.match(req).then(m=>m||fetch(req).then(r=>{
      if(r.ok||r.type==="opaque"){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;
    })));
    return;
  }
  e.respondWith(caches.match(req).then(m=>m||fetch(req)));
});
