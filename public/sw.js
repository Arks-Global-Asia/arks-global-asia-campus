self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>new Response('<h1>You’re offline</h1><p>Reconnect to access your Arks campus. Your submitted work is safely stored.</p>',{headers:{'Content-Type':'text/html'}})))});
