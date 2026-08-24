# Lo que hay que tocar en Cloudflare — y por qué está escrito aquí

Cloudflare proxea las dos zonas (`openlen.com` y `openlen.app`), así que **toca
el HTML de todas las páginas publicadas antes de que llegue al visitante**. Dos
de sus funciones automáticas chocan con la CSP que sella cada página.

Esto vive en el repo porque una configuración que sólo existe en un panel es
exactamente lo que convirtió «emitir un certificado» en «emitir un certificado
Y acordarse de editar un hook que nadie recuerda» (ver
`infra/caddy/letsencrypt-deploy-hook.sh`).

---

## 1 · Email Address Obfuscation — APAGAR en las dos zonas

**Dónde:** Cloudflare → zona → *Scrape Shield* → *Email Address Obfuscation* → Off.

**Qué pasa si está encendida.** Cloudflare reescribe cada dirección de correo del
HTML y mete `/cdn-cgi/scripts/…/email-decode.min.js` para descifrarla en el
navegador. El sellado (`crates/html-engine/src/publish/seal.rs`) pina `script-src`
a los hashes de los scripts que el documento YA traía, así que ese script no
entra nunca. Medido el 2026-08-24 en una página recién publicada:

```
texto visible: [email protected]
href:          /cdn-cgi/l/email-protection#066e696a674660696569286776
consola:       Loading the script '…/email-decode.min.js' violates the
               following Content Security Policy directive: "script-src 'sha256-…'"
```

El visitante lee el marcador de Cloudflare donde debería estar el correo del
negocio. **No se ve en el editor**: `preview-bake.ts` no sella, así que en la
vista previa el script carga y el correo se ve bien.

**El repo ya se defiende solo.** `lib/publish/cloudflare-email.ts` envuelve cada
documento del release en `<!--email_off-->…<!--email_on-->`, que es la salida
oficial de Cloudflare. Apagar el interruptor sigue siendo lo correcto —una cosa
menos que Cloudflare toca— pero ya no es lo único que nos separa del fallo.

## 2 · Web Analytics automático — opcional

Cloudflare inyecta `static.cloudflareinsights.com/beacon.min.js` en cada página.
La CSP también lo bloquea, así que no mide nada y deja un error rojo en la
consola de todas las páginas publicadas. Analítica propia ya hay
(`lib/analytics/`). Apagarlo deja la consola limpia:
zona → *Web Analytics* → quitar el sitio del *automatic setup*.

## 3 · `openlen.app` a secas — la página aparcada de Hostinger

El comodín `*.openlen.app` sirve las páginas de los usuarios desde el box. El
ápice **no**: sigue apuntando al servidor de aparcamiento de Hostinger y
devuelve «Parked Domain name on Hostinger DNS system».

**Decisión: redirección 301 a `openlen.com`.** El `.app` es donde viven las
páginas de los usuarios; la casa del producto es el `.com`. Dos portadas serían
contenido duplicado, dos sesiones y dos sitios que mantener.

**Cómo:** Cloudflare → zona `openlen.app` → *Rules* → *Redirect Rules* → crear:

| campo | valor |
|---|---|
| Cuándo | `Hostname` **equals** `openlen.app` **or** `Hostname` equals `www.openlen.app` |
| Entonces | Static/Dynamic redirect → `concat("https://openlen.com", http.request.uri.path)` |
| Código | 301 · *Preserve query string* activado |

Se resuelve en el borde: no hace falta tocar el box, ni DNS, ni certificados
(el Universal SSL de Cloudflare ya cubre el ápice). El registro que hoy apunta a
Hostinger puede quedarse — la regla se dispara antes.

**Comprobar:**

```bash
curl -sI https://openlen.app | head -3     # 301 → https://openlen.com/
curl -s https://kira.openlen.app -o /dev/null -w '%{http_code}\n'   # 200, intacto
```
