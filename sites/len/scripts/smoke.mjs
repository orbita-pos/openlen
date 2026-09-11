// Lo que ve un usuario de verdad: sin --resolve, por Cloudflare, como el navegador.
//
// 🔴 POR QUÉ YA NO ES CURL. Lo era, y en Windows fallaba A MEDIAS, que es la
// peor forma de fallar: el curl de mingw devuelve 43 («bad function argument»)
// en cuanto se le pide `-w '%{http_code}'`, así que las OCHO comprobaciones de
// código salían `000` y las cuatro de cabecera —que usaban `-sSI`, sin `-w`—
// pasaban tan ricamente. Medido el 2026-09-11: el despliegue salió bien, el
// sitio respondía las trece en el navegador, y el smoke reportó ocho fallos.
// Un smoke que miente en esa dirección es peor que no tenerlo.
//
// La cabecera vieja documentaba el bug y ofrecía un rodeo
// (`CURL=/c/Windows/system32/curl.exe npm run smoke`). No basta: una puerta que
// sólo corre si te acuerdas de una variable de entorno es una puerta que no
// corre. `fetch` es nativo en Node desde la 18, no depende de qué curl haya
// instalado, y es el mismo Node con el que corren las otras tres puertas.
//
// Las comprobaciones son LAS MISMAS y en el mismo orden — sólo cambia el
// transporte. `redirect: "manual"` hace lo que hacía curl por defecto: sin él
// fetch seguiría el 302 y el primer caso no podría verlo.

const B = "https://len.openlen.com";
let fallo = 0;

function ok(actual, esperado, que) {
  if (actual === esperado) {
    console.log(`✔ ${que} (${actual})`);
  } else {
    console.log(`✘ ${que}: esperaba ${esperado}, llegó ${actual}`);
    fallo = 1;
  }
}

// El bash hacía `awk '{print $2}'` sobre la línea de cabecera, o sea el primer
// token tras el espacio. Se replica TAL CUAL: cambiar el transporte no puede
// cambiar lo que la puerta afirma.
const primerToken = (v) => (v ?? "").trim().split(/\s+/)[0];

function pedir(ruta, { metodo = "GET", idioma } = {}) {
  return fetch(B + ruta, {
    method: metodo,
    redirect: "manual",
    ...(idioma ? { headers: { "Accept-Language": idioma } } : {}),
  });
}

// Un tropiezo de red no tumba el script, igual que el bash seguía y salía con 1
// al final: si abortara, un fallo escondería todas las comprobaciones que
// quedan, que es justo lo que acaba de pasarnos con curl.
async function codigo(ruta, opts) {
  try {
    return String((await pedir(ruta, opts)).status);
  } catch (e) {
    console.log(`  (red) ${ruta}: ${e.message}`);
    return "000";
  }
}

async function cabecera(ruta, nombre, opts) {
  try {
    const r = await pedir(ruta, { ...opts, metodo: "HEAD" });
    return primerToken(r.headers.get(nombre));
  } catch (e) {
    console.log(`  (red) ${ruta}: ${e.message}`);
    return "";
  }
}

const ES = "es-MX,es;q=0.9";
const EN = "en-US,en;q=0.9,es;q=0.8";

ok(await codigo("/", { idioma: ES }), "302", "/ con español");
ok(await cabecera("/", "location", { idioma: ES }), "/es/", "/ → /es/");
ok(await cabecera("/", "location", { idioma: EN }), "/en/", "/ → /en/");
ok(await cabecera("/", "cache-control"), "no-store", "la raíz no se cachea");

for (const p of [
  "/en/",
  "/es/",
  "/en/research/",
  "/es/principles/",
  "/es/research/when-the-agent-said-done/",
  "/sitemap.xml",
  "/robots.txt",
]) {
  ok(await codigo(p), "200", p);
}

ok(await codigo("/no-existe/"), "404", "404 de verdad");

// Calentar y preguntar: la primera petición puede ser MISS legítimamente.
await pedir("/en/").catch(() => {});
ok(await cabecera("/en/", "cf-cache-status"), "HIT", "/en/ desde la caché de borde");

process.exit(fallo);
