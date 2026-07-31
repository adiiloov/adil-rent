// Координаты из ссылки Google Maps: /api/geo?url=...
//
// Зачем нужен сервер. Длинную ссылку вида .../@24.46,39.61,17z приложение
// разбирает само, прямо в телефоне. Но кнопка «Поделиться» в Google Maps
// отдаёт короткую — maps.app.goo.gl/XXXX, — а в ней координат нет вообще:
// они появятся только после перехода по редиректу. Сделать этот переход из
// браузера нельзя, чужой домен не разрешает читать свои ответы. Поэтому
// ходим за редиректом здесь, на сервере, и возвращаем приложению готовую
// пару чисел.

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Пускаем только карты Google: иначе получится открытый прокси, которым
// можно дёргать любой адрес в интернете от имени нашего домена.
const ALLOWED = /^(?:[a-z0-9-]+\.)*(google\.[a-z.]{2,6}|goo\.gl|maps\.app\.goo\.gl)$/i;

function parseCoords(raw) {
  const s = decodeURIComponent(String(raw || ''));

  // !3d<lat>!4d<lng> — сама точка места. Стоит первой: !3d/!4d указывают на
  // дом, а @ — всего лишь на центр экрана, который может быть в стороне.
  let m = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (m) return [+m[1], +m[2]];

  // ?q=lat,lng и &query=lat,lng — так выглядит ссылка «поделиться точкой»
  m = s.match(/[?&](?:q|query|destination|center)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];

  // /@lat,lng,17z — обычная ссылка из адресной строки
  m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];

  // ?ll=lat,lng — старый формат
  m = s.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];

  return null;
}

function valid(p) {
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1])
    && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180
    && !(p[0] === 0 && p[1] === 0);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const raw = String(req.query.url || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let u;
  try { u = new URL(raw); } catch (e) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'bad_url' }));
  }
  if (!/^https?:$/.test(u.protocol) || !ALLOWED.test(u.hostname)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'not_google_maps' }));
  }

  // Координаты бывают видны уже в самой ссылке — тогда никуда идти не нужно.
  let point = parseCoords(raw);

  // Иначе идём по цепочке редиректов вручную: короткая ссылка обычно
  // разворачивается за один-два шага, но бывает и три.
  if (!valid(point)) {
    let url = raw;
    try {
      for (let hop = 0; hop < 4 && !valid(point); hop++) {
        const r = await fetch(url, {
          redirect: 'manual',
          headers: { 'User-Agent': UA, 'Accept-Language': 'en' }
        });
        const next = r.headers.get('location');
        if (next) {
          url = new URL(next, url).toString();
          point = parseCoords(url);
          continue;
        }
        // Редиректов больше нет — координаты могут лежать в самой странице.
        if (r.ok) {
          const body = (await r.text()).slice(0, 400000);
          point = parseCoords(body) || parseCoords(url);
        }
        break;
      }
    } catch (e) {
      console.error('[geo]', e && e.message);
    }
  }

  if (!valid(point)) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: false }));
  }

  // Одна и та же ссылка всегда даёт одну и ту же точку — держим ответ в кэше
  // сети доставки, чтобы не ходить в Google на каждое нажатие клавиши.
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400');
  res.end(JSON.stringify({ ok: true, lat: point[0], lng: point[1] }));
};
