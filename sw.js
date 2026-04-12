// v2 — 구버전 캐시 삭제 + 열린 탭 강제 새로고침
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 모든 캐시 삭제
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // 현재 열린 모든 탭 강제 새로고침
    await self.clients.claim();
    const all = await self.clients.matchAll({ type: 'window' });
    await Promise.all(all.map(c => c.navigate(c.url).catch(() => {})));
    // SW 해제 (이후 네트워크 직접 요청)
    await self.registration.unregister();
  })());
});
