// Vercel Serverless Function
// Resolves short Google Maps links (maps.app.goo.gl / goo.gl/maps / g.co/kgs)
// to their final URL, which contains the real coordinates.
// Needed because browsers block client-side JS from reading cross-origin
// redirect targets (CORS) — this has to happen server-side.
//
// Deploy: place this file at  api/resolve-gmaps.js  in the repo root.
// Vercel auto-detects anything under /api as a serverless function —
// no extra config needed. After pushing, it will be live at:
//   https://adilrent.com/api/resolve-gmaps?url=...

export default async function handler(req, res) {
  const url = req.query.url;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Only allow resolving Google's own short-link domains — avoids this
  // endpoint being abused as an open URL-fetch proxy.
  const allowedHosts = ['maps.app.goo.gl', 'goo.gl', 'g.co'];
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  if (!allowedHosts.includes(hostname)) {
    return res.status(400).json({ error: 'Host not allowed' });
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // A normal browser UA + Accept-Language gets the fullest redirect chain from Google
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        // Pre-accepting Google's cookie/consent interstitial avoids the
        // request landing on consent.google.com instead of the real maps URL.
        'Cookie': 'CONSENT=YES+1',
      },
    });
    let finalUrl = response.url;
    // If Google still routed us through the consent interstitial, try to
    // pull the real destination out of its "continue" query parameter.
    if (finalUrl.includes('consent.google.com')) {
      try {
        const cont = new URL(finalUrl).searchParams.get('continue');
        if (cont) finalUrl = cont;
      } catch {}
    }

    // Try to pull lat/lng directly out of the resolved URL first (works for
    // pin-dropped locations shared from the map).
    const direct = extractCoords(finalUrl);
    if (direct) {
      return res.status(200).json({ finalUrl, lat: direct.lat, lng: direct.lng });
    }

    // No coordinates embedded — this happens when the link was shared from a
    // named place/business (e.g. "?q=Мечеть+Медина"). Geocode the place text
    // instead, using the same Maps API key already used on the frontend.
    let queryText = null;
    try { queryText = new URL(finalUrl).searchParams.get('q'); } catch {}
    if (queryText && !/^-?\d+\.\d+,-?\d+\.\d+$/.test(queryText)) {
      const apiKey = 'AIzaSyDMjw0h7cMQBl9QQEpyurfUtjmYEaa0fUQ';
      const geoRes = await fetch(
        'https://maps.googleapis.com/maps/api/geocode/json?address=' +
          encodeURIComponent(queryText) +
          '&key=' + apiKey
      );
      const geoData = await geoRes.json();
      if (geoData.status === 'OK' && geoData.results && geoData.results[0]) {
        const loc = geoData.results[0].geometry.location;
        return res.status(200).json({ finalUrl, lat: loc.lat, lng: loc.lng, geocoded: true });
      }
      return res.status(200).json({
        finalUrl,
        error: 'геокодирование не удалось (' + geoData.status + ')',
      });
    }

    return res.status(200).json({ finalUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve link' });
  }
}

function extractCoords(url) {
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}
