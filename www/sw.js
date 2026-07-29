const CACHE = 'adil-v1';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  // Only cache GET requests
  if(e.request.method !== 'GET') return;
  
  // Don't cache Supabase/Google API calls
  var url = e.request.url;
  if(url.includes('supabase.co') || url.includes('googleapis.com') || url.includes('maps.google')) return;

  // Ссылки на объявления (/a/12, /c/4) отдаёт функция превью — она сама
  // перенаправляет в приложение. Класть такой ответ в кэш нельзя: объявление
  // снимут, а старый редирект останется жить в телефоне.
  if(/\/(a|c)\/\d+/.test(new URL(url).pathname)) return;
  
  e.respondWith(
    fetch(e.request).then(function(response){
      // Cache successful responses
      if(response.ok){
        var clone = response.clone();
        caches.open(CACHE).then(function(cache){ cache.put(e.request, clone); });
      }
      return response;
    }).catch(function(){
      // Serve from cache when offline
      return caches.match(e.request).then(function(cached){
        return cached || caches.match('/');
      });
    })
  );
});
