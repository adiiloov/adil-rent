const CACHE = 'adil-v2';        // оболочка приложения, чистится при обновлении
const MEDIA = 'adil-media-v1';  // снимки объявлений, живут между версиями
const MEDIA_MAX = 220;          // примерно 25–30 объявлений со всеми снимками

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
      // Кэш снимков переживает обновление приложения: файлы в хранилище
      // неизменны, перекачивать их заново на каждую версию незачем.
      return Promise.all(keys
        .filter(function(k){ return k!==CACHE && k!==MEDIA; })
        .map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Кэш снимков растёт бесконечно, если его не подрезать: человек листает
// каталог месяцами, а в телефоне оседают сотни мегабайт. Держим последние
// MEDIA_MAX файлов, самые старые выкидываем.
async function trimMedia(cache){
  const keys = await cache.keys();
  if(keys.length <= MEDIA_MAX) return;
  await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map(function(k){ return cache.delete(k); }));
}

// Снимок объявления не меняется никогда — у него в имени метка времени.
// Поэтому берём из кэша сразу, не спрашивая сеть: при повторном заходе
// список открывается с картинками мгновенно и работает без интернета.
async function mediaFirst(request){
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(request);
  if(hit) return hit;
  const res = await fetch(request);
  if(res.ok){
    cache.put(request, res.clone()).then(function(){ trimMedia(cache); });
  }
  return res;
}

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;

  const url = e.request.url;

  // Снимки и видео объявлений — единственное, что кэшируем с домена
  // хранилища. Запросы к базе и авторизации должны идти в сеть всегда.
  if(url.includes('/storage/v1/object/public/')){
    e.respondWith(mediaFirst(e.request).catch(function(){
      return caches.match(e.request);
    }));
    return;
  }

  if(url.includes('supabase.co') || url.includes('googleapis.com') || url.includes('maps.google')) return;

  // Ответ /api/geo зависит от адреса в запросе и живёт в кэше сети доставки —
  // в телефоне ему делать нечего.
  if(new URL(url).pathname.startsWith('/api/')) return;

  // Ссылки на объявления (/a/12, /c/4) отдаёт функция превью — она сама
  // перенаправляет в приложение. Класть такой ответ в кэш нельзя: объявление
  // снимут, а старый редирект останется жить в телефоне.
  if(/\/(a|c)\/\d+/.test(new URL(url).pathname)) return;

  e.respondWith(
    fetch(e.request).then(function(response){
      if(response.ok){
        var clone = response.clone();
        caches.open(CACHE).then(function(cache){ cache.put(e.request, clone); });
      }
      return response;
    }).catch(function(){
      return caches.match(e.request).then(function(cached){
        return cached || caches.match('/');
      });
    })
  );
});
