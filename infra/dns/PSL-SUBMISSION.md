# `openlen.app` en la Public Suffix List

Material listo para mandar. **Nada de esto está hecho todavía**: el PR y el
registro DNS los tiene que crear Jesús desde sus cuentas.

Preparado el 2026-08-31, a raíz del hallazgo 4 del barrido, donde se decidió:
**PSL primero, y luego las librerías**.

---

## 1 · La decisión que cambió al preparar esto: sólo `.app`

El barrido hablaba de «las páginas comparten `*.openlen.app`». Al mirar la
infraestructura de verdad, la petición correcta es **`openlen.app` a secas, y
NO `openlen.com`**:

| host | qué sirve | ¿puede ir a la PSL? |
|---|---|---|
| `openlen.com`, `www.openlen.com` | **la app**, reverse-proxy a Next :3000 (`Caddyfile:49`) — con la sesión de Auth.js | ❌ No. Es la casa del producto |
| `openlen.app` (ápice) | **nada**: una regla de redirección 301 de Cloudflare a `openlen.com` (`CLOUDFLARE-ZONA.md` §3) | ✅ Sí. No hay nada que romper |
| `*.openlen.com`, `*.openlen.app` | las páginas de los usuarios, ficheros del disco (`Caddyfile:108`) | — es lo que se protege |

Comprobado antes de escribir esto, y todo salió limpio:

- **Ninguna cookie de dominio padre en el repo.** Buscado `Domain=.` y
  `domain: "."` en `app/` y `lib/`: cero.
- **La cookie del Chat privado no lleva `Domain`** (`lib/chat/session.ts:22`),
  así que ya es *host-only*: vive en `<sub>.openlen.app` y en ningún otro sitio.
  La PSL no la toca.
- **La baliza de analítica no pone cookies** — lo dice su propia cabecera
  (`app/c/[projectId]/route.ts:31`: «No IP stored. No cookies.»).
- **La sesión de la app no fija `domain`**, o sea *host-only* en `openlen.com`.

`openlen.com` puede pedirse más adelante, en un PR aparte, si algún día se
retiran las páginas de `*.openlen.com`. Hoy no.

## 2 · Por qué — y no es hipotético

Lo dice el propio código, en `crates/html-engine/src/publish/seal.rs`:

> LA CSP SE RETIRÓ el 2026-08-26 (…) LO QUE ACOTA EL DAÑO AHORA es el dominio,
> no la jaula: las páginas viven en `openlen.app`, separado de la app. **Meterlo
> en la Public Suffix List es lo que hace que un sitio turbio se queme solo en
> vez de arrastrar al comodín — está pendiente y anotado.**

O sea: la PSL **no es un endurecimiento opcional, es la mitigación con la que se
cambió un control que se retiró**. La CSP fijaba `script-src` por hash; dejó de
tener sentido cuando el código del modelo pasó a ser el código de la página.

El agujero concreto que queda abierto mientras tanto:

> `*.openlen.app` aloja sitios de usuarios que **no se fían entre sí**, y desde
> que el JavaScript del modelo está abierto esos sitios **ejecutan su propio
> código**. Hoy, `mala.openlen.app` puede hacer
> `document.cookie = "x=y; domain=.openlen.app"` y esa cookie se le manda a
> `buena.openlen.app`. Nuestro código servidor está limpio; el de las páginas no
> es nuestro, y ése es justo el punto.

`localStorage` no está afectado (ya se aísla por origen). Lo que la PSL arregla
es el eje de las cookies, más el particionado de almacenamiento y todo lo que el
navegador indexa por eTLD+1.

Y por eso va **antes** que las librerías del hallazgo 4: abrir Chart.js, Swiper
y PhotoSwipe amplía la superficie de JS de terceros sobre exactamente este
escenario.

## 3 · El parche a `public_suffix_list.dat`

Repo: <https://github.com/publicsuffix/list>

Ordenado **por el nombre de la empresa del comentario**. `OpenLen` cae entre
`OpenHost` y `OpenResearch GmbH` — hoy, líneas 15095–15101. **No lo pegues al
final del fichero**: es motivo de rechazo.

```diff
 // OpenHost : https://registry.openhost.uk
 // Submitted by OpenHost Registry Team <support@openhost.uk>
 16-b.it
 32-b.it
 64-b.it
 
+// OpenLen : https://openlen.com/
+// Submitted by <NOMBRE> <ops@openlen.com>
+openlen.app
+
 // OpenResearch GmbH : https://openresearch.com/
 // Submitted by Philipp Schmid <ops@openresearch.com>
 orsites.com
```

El formato de las dos líneas de comentario es el que usan Vercel y Netlify,
copiado literal de la lista:

```
// Vercel, Inc : https://vercel.com/
// Submitted by Laurens Duijvesteijn <security@vercel.com>
vercel.app
```

## 4 · El registro DNS `_psl`

Obligatorio para el bloque `PRIVATE`. Es lo que prueba que quien manda el PR
manda en el dominio.

| campo | valor |
|---|---|
| Zona | `openlen.app` (Cloudflare) |
| Tipo | `TXT` |
| Nombre | `_psl` (queda `_psl.openlen.app`) |
| Contenido | la URL del PR, p. ej. `https://github.com/publicsuffix/list/pull/2345` |
| Proxy | **DNS only** (nube gris) — es un TXT |

Orden real: **abre el PR primero**, coge su número, y luego crea el TXT — el
contenido es la URL del PR.

⚠️ **El `_psl` se queda para siempre.** La guía es explícita: quitarlo se lee
como que ya no quieres estar en la lista.

## 5 · El cuerpo del PR — listo para pegar

En inglés, que es el idioma del repo. Rellena `<NOMBRE>` y la fecha de caducidad
antes de mandarlo.

```markdown
### Submission for the PRIVATE section: openlen.app

**Organisation:** OpenLen — https://openlen.com/
**Contact:** <NOMBRE> <ops@openlen.com>
**Requested entry:** `openlen.app`
**Validation record:** `_psl.openlen.app` TXT, containing the URL of this PR

#### Rationale

OpenLen is a landing-page builder. Users describe, edit and publish a site, and
each published site is served from its own subdomain of `openlen.app`
(`<subdomain>.openlen.app`). These subdomains are allocated to distinct,
mutually untrusted end users, and the pages themselves may contain
user-authored (or AI-authored, user-owned) JavaScript.

Without a public-suffix boundary at `openlen.app`, a page on one subdomain can
set a cookie scoped to the shared parent domain (`Domain=.openlen.app`), which
the browser will then send to every other subdomain. That is a cross-tenant
cookie-injection and session-fixation vector between unrelated customers.
Listing `openlen.app` makes each `<subdomain>.openlen.app` its own registrable
domain, so cookie scope and browser storage partitioning follow the tenant
boundary.

This is the same situation, and the same request, as the existing entries for
`vercel.app`, `netlify.app` and `github.io`.

#### Scope of this request

We are requesting **only** `openlen.app`, not our primary domain `openlen.com`.
`openlen.com` hosts the application itself (including authenticated sessions)
and is deliberately kept out of this request. The apex `openlen.app` serves no
application: it is a 301 redirect to `openlen.com`. We host no first-party
cookies on `openlen.app` today.

#### Registration commitment

`openlen.app` is registered through Hostinger, with DNS on Cloudflare. Its
registration runs until <FECHA — tiene que quedar MÁS DE 2 AÑOS>. We commit to
maintaining the registration in good standing with more than one year remaining
in its term, and to keeping the `_psl` TXT record in place after validation to
signal that continued inclusion is desired.
```

## 6 · Lo que tiene que hacer Jesús

- [ ] **Comprobar la caducidad de `openlen.app` en Hostinger.** Requisito duro:
      **más de 2 años** por delante. Si no llega, renovar ANTES de mandar el PR
      — es motivo de rechazo, y volver a pedirlo cuesta otra ronda de espera.
- [ ] Decidir el nombre y el correo del `Submitted by`. Recomiendo
      **`ops@openlen.com`**: ya es el contacto ACME del Caddyfile (`:34`), o sea
      que es un correo del dominio y no una cuenta personal.
- [ ] Fork de `publicsuffix/list`, aplicar el parche de §3, abrir el PR con el
      cuerpo de §5.
- [ ] Crear el TXT `_psl.openlen.app` con la URL del PR (§4).
- [ ] Responder a lo que pidan los mantenedores. **No hay ETA**: la propia guía
      dice que no garantizan inclusión ni dan plazo. Cuenta con semanas, y con
      que llegar a los navegadores es otro ciclo más (cada uno embebe su copia).

## 7 · Comprobar

```bash
curl -sI https://openlen.app | head -3
```

```bash
dig +short TXT _psl.openlen.app
```

Y una vez la lista lo recoja, sobre una página real: poner
`document.cookie = "t=1; domain=.openlen.app"` en la consola de
`<sub>.openlen.app` deja de tener efecto.

## 8 · Lo que esto NO arregla

Para que no se lea como una casilla marcada:

- **No devuelve la CSP.** Un sitio turbio sigue pudiendo hacer lo que quiera
  DENTRO de su propio subdominio; lo que deja de poder es arrastrar a los
  vecinos.
- **No cubre `*.openlen.com`.** Esas páginas siguen compartiendo dominio padre
  con la app. Mitigado hoy porque las cookies de sesión son *host-only*, pero es
  deuda: lo que la cierra del todo es terminar de mover las páginas al `.app`.
- **No es instantáneo.** Entre el PR y el navegador de un visitante hay dos
  ciclos de publicación que no controlamos.
