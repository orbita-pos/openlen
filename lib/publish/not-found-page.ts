// The branded dead-link page — what a visitor sees when they follow a link
// to a subdomain that doesn't exist (or a custom domain with no project).
// This is borrowed traffic from dead creator links, so the page is a tiny
// pitch: even our 404 wears a world, and the CTA points home.
//
// Single source of truth. Consumers:
//   - app/served/[host]/[[...path]]/route.ts → custom-domain misses (Node)
//   - infra/scripts/apply-404.ps1 → emits this to /var/www/openlen/_system/
//     404.html, which the Caddyfile's handle_errors serves for dead
//     *.openlen.com subdomains (static, no Node hop)
//
// Zero external requests: inline SVG mark, system font stack, inline CSS.

export const NOT_FOUND_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>404 — Esta página no existe · OpenLen</title>
<style>
  :root{
    --bg:#fdf8f4;--fg:#1c1410;--muted:#7a6c63;--accent:#ff5a36;--accent-deep:#d63916;
    --card:rgba(255,255,255,.62);--ring:rgba(28,20,16,.08);
  }
  @media (prefers-color-scheme:dark){
    :root{--bg:#16100d;--fg:#f5efe9;--muted:#a99a8f;--card:rgba(255,255,255,.05);--ring:rgba(255,255,255,.10)}
  }
  *{margin:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:var(--bg);color:var(--fg);display:grid;place-items:center;
    padding:24px;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden;
  }
  body::before{
    content:"";position:fixed;inset:-20%;z-index:0;pointer-events:none;
    background:
      radial-gradient(42% 38% at 18% 12%,rgba(255,126,85,.28),transparent 70%),
      radial-gradient(46% 42% at 84% 86%,rgba(214,57,22,.20),transparent 70%),
      radial-gradient(30% 26% at 78% 16%,rgba(255,90,54,.14),transparent 70%);
    filter:blur(2px);
  }
  body::after{
    content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  main{
    position:relative;z-index:1;text-align:center;max-width:540px;width:100%;
    background:var(--card);border:1px solid var(--ring);border-radius:28px;
    padding:clamp(40px,7vw,64px) clamp(24px,6vw,56px);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 24px 80px -24px rgba(214,57,22,.18);
  }
  .mark{width:52px;height:52px;margin:0 auto 22px;display:block}
  h1{
    font-size:clamp(72px,18vw,116px);line-height:.9;letter-spacing:-.045em;font-weight:700;
    background:linear-gradient(135deg,#ff7e55 0%,#ff5a36 52%,#d63916 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  .es{margin-top:18px;font-size:clamp(17px,4.4vw,21px);font-weight:600;letter-spacing:-.015em}
  .en{margin-top:6px;font-size:14px;color:var(--muted)}
  .cta{
    display:inline-flex;align-items:center;gap:8px;margin-top:28px;
    background:var(--accent-deep);color:#fff;text-decoration:none;font-weight:600;
    font-size:14.5px;padding:13px 26px;border-radius:999px;
    box-shadow:0 1px 2px rgba(255,90,54,.35),0 10px 28px -6px rgba(255,90,54,.5);
    transition:filter .15s,transform .15s;
  }
  .cta:hover{filter:brightness(1.07)}
  .cta:active{transform:scale(.98)}
  .cta svg{flex:none}
  .foot{margin-top:30px;font-size:11.5px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase}
  .foot a{color:inherit;text-decoration:none}
  .foot a:hover{color:var(--accent)}
</style>
</head>
<body>
<main>
  <svg class="mark" viewBox="0 0 64 64" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="14" y1="11" x2="52" y2="55" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FF7E55"/><stop offset="0.52" stop-color="#FF5A36"/><stop offset="1" stop-color="#E5391A"/>
    </linearGradient></defs>
    <circle cx="32" cy="32" r="19.5" stroke="url(#g)" stroke-width="15"/>
  </svg>
  <h1>404</h1>
  <p class="es">Esta página no existe… todavía.</p>
  <p class="en">This page doesn&rsquo;t exist&hellip; yet.</p>
  <a class="cta" href="https://openlen.com/?utm_source=dead-page&amp;utm_medium=404">
    Crea la tuya gratis
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </a>
  <p class="foot"><a href="https://openlen.com">openlen.com</a></p>
</main>
</body>
</html>
`;
