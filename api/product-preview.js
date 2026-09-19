// Facebook/WhatsApp/etc. crawlers don't run JS, so they never see the
// client-side-rendered product page - they'd otherwise always get the same
// generic homepage meta tags regardless of which product's link was shared.
// vercel.json rewrites "/p/<id>" (the link copyProductLink() generates) to
// this function - a plain path rewrite, unlike the query+header "has"
// conditions this used before, which never actually matched in production.
function escapeHtml(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const BOT_UA = /facebookexternalhit|facebot|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|pinterest|redditbot|skypeuripreview|applebot|vkshare/i;

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl =
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://veronza.vercel.app');
  const id = String((req.query || {}).p || '').trim();
  const pageUrl = `${siteUrl}/?p=${encodeURIComponent(id)}#sections`;

  // Real visitors shouldn't get stuck on this bot-only meta page - send them
  // straight to the actual app. /index.html (not "/") so this doesn't loop
  // back into the same rewrite.
  if (!BOT_UA.test(req.headers['user-agent'] || '')) {
    res.statusCode = 302;
    res.setHeader('Location', `/index.html?p=${encodeURIComponent(id)}#sections`);
    return res.end();
  }

  let title = 'VERONZA BOUTIQUE — أحذية وشنط';
  let description = 'Veronza Boutique — أحذية وشنط بتصاميم راقية وتجربة تسوق فاخرة.';
  let image = `${siteUrl}/images/images%3Apromo-set.jpg`;

  if (id && supabaseUrl && serviceKey) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/products?select=name,price,discount_price,img&id=eq.${encodeURIComponent(id)}&is_active=eq.true&limit=1`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      const product = r.ok ? (await r.json())[0] : null;
      if (product) {
        const price =
          product.discount_price != null && product.discount_price < product.price
            ? product.discount_price
            : product.price;
        title = `${product.name} — VERONZA BOUTIQUE`;
        description = `${Number(price).toLocaleString('en-US')} د.ل — VERONZA BOUTIQUE`;
        if (product.img) image = product.img;
      }
    } catch (_) {}
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="VERONZA BOUTIQUE">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escapeHtml(pageUrl)}">
</head><body>
<a href="${escapeHtml(pageUrl)}">${escapeHtml(title)}</a>
</body></html>`);
};
