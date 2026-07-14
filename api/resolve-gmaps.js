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
    return res.status(200).json({ finalUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve link' });
  }
}
