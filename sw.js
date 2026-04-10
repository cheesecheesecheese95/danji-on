const CACHE = 'pvx-on-v4';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/','./index.html'])).catch(()=>{}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if(e.request.url.includes('supabase.co') || e.request.url.includes('/api/')) return;
  // HTML: network-first (always get fresh page)
  if(e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')){
    e.respondWith(
      fetch(e.request).then(r => {
        if(r && r.status===200){
          const clone = r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,clone));
        }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if(r && r.status===200 && r.type!=='opaque'){
        const clone = r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,clone));
      }
      return r;
    }).catch(() => caches.match('./index.html')))
  );
});
