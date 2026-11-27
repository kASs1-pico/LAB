/* Keep the HTML and its script graph in the same offline release. */
const prefix='drafting-lab:'+self.registration.scope+':';
const currentCache=prefix+'3';
const indexURL=new URL('index.html',self.registration.scope).href;
const localURL=path=>new URL(path,self.registration.scope).href;

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const response=await fetch(indexURL,{cache:'reload'});
    if(!response.ok)throw new Error('Cannot cache the laboratory entry point.');
    const html=await response.clone().text();
    const names=[...html.matchAll(/<(?:script|link)\s+[^>]*(?:src|href)="(\.\/[^"]+)"/g)].map(match=>match[1]);
    const assets=new Set([...names,'src/workers/print-worker.js','src/workers/model-worker.js','assets/icons/lab-icon-192.png','assets/icons/lab-icon-512.png']);
    const cache=await caches.open(currentCache);
    await cache.addAll([...assets].map(path=>new Request(localURL(path),{cache:'reload'})));
    await cache.put(indexURL,response);
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==currentCache)await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(!url.href.startsWith(self.registration.scope))return;
  const path=url.href.split(/[?#]/,1)[0];
  const target=event.request.mode==='navigate'&&(path===self.registration.scope||path===indexURL)?indexURL:path;
  if(path!==self.registration.scope&&path!==indexURL&&!/\.(?:js|css|svg|png|webmanifest)$/.test(path))return;
  event.respondWith((async()=>{
    const cache=await caches.open(currentCache);
    return await cache.match(target)||fetch(event.request);
  })());
});
