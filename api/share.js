// Ссылка на одно объявление: /a/12 — квартира, /c/4 — машина.
//
// Зачем это нужно. Раньше приложение жило по одному адресу adilrent.com,
// и отправить человеку конкретную квартиру было нечем. Теперь у каждого
// объявления есть свой адрес, а когда его кидают в WhatsApp — там сразу
// разворачивается фото, цена и время пешком до Мечети Пророка.
//
// Как устроено. Мессенджеры не выполняют скрипты: их робот читает только
// то, что пришло в первом ответе. Поэтому роботу мы отдаём страницу с
// og-разметкой, а живому человеку — сразу перенаправление в приложение,
// чтобы он не видел промежуточный экран.

const SUPABASE_URL = 'https://bqtpoxksmlxnatxrrhva.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rfMc_DEldXr8hN-hrb63cg_fOFFTW8G';
const SITE = 'https://www.adilrent.com';

// Координаты Мечети Пророка и поправки на дорогу — те же, что в приложении,
// иначе в превью и в карточке будут стоять разные минуты.
const MOSQUE = [24.4672, 39.6113];
const WALK_DETOUR = 1.25, WALK_KMH = 4.5;

const BOT = /bot|crawler|spider|preview|fetcher|whatsapp|telegram|facebookexternalhit|facebot|twitter|slack|discord|linkedin|vkshare|skype|viber|snapchat|pinterest|embed|curl|wget|python-requests|go-http|okhttp/i;

const FIELDS = {
  apt: 'id,title_ru,title_en,type,district_ru,district_en,description_ru,description_en,price,price_note,photos,lat,lng,is_active,is_archived',
  // У машин колонки description_en нет — просить её нельзя, база ответит ошибкой.
  car: 'id,title_ru,specs_ru,specs_en,description_ru,price,price_note,photos,is_active,is_archived'
};

const NOTE_EN = { '/мес': '/mo', '/сутки': '/day', '/неделя': '/week', '/год': '/year' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function haversineM(a1, o1, a2, o2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (a2 - a1) * rad, dLon = (o2 - o1) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function walkLine(item, en) {
  if (!item || item.lat == null || item.lng == null) return '';
  const m = Math.round(haversineM(item.lat, item.lng, MOSQUE[0], MOSQUE[1]) * WALK_DETOUR);
  const min = Math.max(1, Math.round(m / 1000 / WALK_KMH * 60));
  if (min > 90) return '';
  return en ? (min + ' min walk to the Prophet\'s Mosque')
            : (min + ' мин пешком до Мечети Пророка');
}

// Первое фото: у объявления в photos может лежать видео, для превью оно не годится.
function firstPhoto(item) {
  const ph = Array.isArray(item.photos) ? item.photos : [];
  for (const p of ph) {
    if (typeof p === 'string' && p && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(p)) {
      return p.startsWith('http') ? p : (SUPABASE_URL + '/storage/v1/object/public/adil-photos/' + p);
    }
  }
  return SITE + '/icons/icon-512.png';
}

function priceStr(item, en) {
  const note = item.price_note || '/мес';
  return (item.price || 0).toLocaleString('ru-RU').replace(/ /g, ' ')
    + ' SAR' + (en ? (NOTE_EN[note] || note) : note);
}

function buildMeta(kind, item, en) {
  const title = (en && item.title_en) ? item.title_en : (item.title_ru || '');
  const parts = [priceStr(item, en)];
  if (kind === 'apt') {
    const district = (en && item.district_en) ? item.district_en : item.district_ru;
    if (district) parts.push(district);
    const walk = walkLine(item, en);
    if (walk) parts.push(walk);
  } else if (item.specs_ru || item.specs_en) {
    parts.push((en && item.specs_en) ? item.specs_en : item.specs_ru);
  }
  let desc = parts.join(' · ');
  const text = ((en && item.description_en) ? item.description_en : item.description_ru || '').replace(/\s+/g, ' ').trim();
  if (text) desc += ' — ' + text;
  if (desc.length > 250) desc = desc.slice(0, 247).trim() + '…';
  return {
    title: title + ' · ' + priceStr(item, en),
    desc,
    image: firstPhoto(item),
    url: SITE + (kind === 'apt' ? '/a/' : '/c/') + item.id
  };
}

// Страница для робота мессенджера. Человек сюда почти не попадает, но если
// попадёт (робот-инкогнито, отключённые скрипты) — увидит нормальную
// карточку в стиле приложения, а не пустой экран.
function html(meta, kind, id, en) {
  const openUrl = '/?' + (kind === 'apt' ? 'a' : 'c') + '=' + id + (en ? '&lang=en' : '');
  return `<!DOCTYPE html>
<html lang="${en ? 'en' : 'ru'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} — AdilRent</title>
<meta name="description" content="${esc(meta.desc)}">
<link rel="canonical" href="${esc(meta.url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AdilRent">
<meta property="og:locale" content="${en ? 'en_US' : 'ru_RU'}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.desc)}">
<meta property="og:image" content="${esc(meta.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="900">
<meta property="og:url" content="${esc(meta.url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.desc)}">
<meta name="twitter:image" content="${esc(meta.image)}">
<meta name="theme-color" content="#0A1424">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0A1424;color:#EAF0FA;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:420px;width:100%;background:#101D33;border:1px solid rgba(255,255,255,.09);
      border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#0A1424}
.in{padding:18px}
h1{font-size:19px;line-height:1.3;margin-bottom:8px;font-weight:700}
.p{color:#D4A257;font-weight:700;font-size:17px;margin-bottom:6px}
.d{color:#93A4BF;font-size:14px;margin-bottom:16px}
a.go{display:block;text-align:center;padding:14px;border-radius:14px;text-decoration:none;font-weight:700;
     color:#231704;background:linear-gradient(180deg,#E8C57F,#C08A2E)}
</style>
<script>location.replace(${JSON.stringify(openUrl)});</script>
</head>
<body>
<div class="card">
  <img src="${esc(meta.image)}" alt="">
  <div class="in">
    <h1>${esc(meta.title)}</h1>
    <div class="d">${esc(meta.desc)}</div>
    <a class="go" href="${esc(openUrl)}">${en ? 'Open in AdilRent' : 'Открыть в AdilRent'}</a>
  </div>
</div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  const kind = req.query.kind === 'car' ? 'car' : 'apt';
  const id = String(req.query.id || '').replace(/[^0-9]/g, '');
  const en = String(req.query.lang || '') === 'en';
  const table = kind === 'apt' ? 'apartments' : 'cars';
  const home = '/' + (id ? ('?' + (kind === 'apt' ? 'a' : 'c') + '=' + id) : '');

  if (!id) { res.writeHead(302, { Location: '/' }); return res.end(); }

  let item = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=${FIELDS[kind]}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
    });
    if (r.ok) { const rows = await r.json(); item = rows && rows[0]; }
    else console.error('[share] db', r.status, await r.text());
  } catch (e) { console.error('[share]', e && e.message); }

  // Объявление снято или удалено: отправляем в каталог, чтобы человек
  // не упирался в ошибку.
  if (!item || item.is_active === false || item.is_archived === true) {
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
    return res.end();
  }

  const ua = req.headers['user-agent'] || '';
  const isBot = !ua || BOT.test(ua) || req.query.preview === '1';

  // По одному адресу мы отдаём два разных ответа — роботу разметку, человеку
  // перенаправление. Без этой строки сеть доставки запомнит первый ответ и
  // начнёт показывать его всем: либо люди застрянут на странице-заглушке,
  // либо в WhatsApp пропадёт превью.
  res.setHeader('Vary', 'User-Agent');
  if (!isBot) {
    res.writeHead(302, { Location: home, 'Cache-Control': 'no-store' });
    return res.end();
  }

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html(buildMeta(kind, item, en), kind, id, en));
};
