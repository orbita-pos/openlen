# Public Suffix List — `openlen.app` (PRIVATE section)

> 🔴 **NO ENVIAR TODAVÍA.** Este borrador está completo, pero el PR se
> **rechazaría hoy** por cuatro motivos independientes, los cuatro **medidos el
> 2026-09-10**, no supuestos. Ninguno es de redacción; tres son de crecimiento o
> de infraestructura y uno es una renovación. Este fichero vale como borrador
> **y como lista de lo que tiene que volverse verdad.**
>
> | # | Lo que pide la PSL | Lo que hay | Cómo se comprobó |
> |---|---|---|---|
> | 1 | **2.000–3.000 usuarios distintos** mínimo — y el template aclara que son individuos **que usan subnombres del espacio pedido**, NO visitantes | **8** usuarios con subdominio publicado (31 cuentas en total) | `select count(distinct "userId") from projects where status='published'` en producción |
> | 2 | **≥2 años** de registro restantes, y mantener **>1 año** para seguir listado | `openlen.app` caduca **2027-08-24** → ~11,5 meses | RDAP: `curl -sL https://rdap.org/domain/openlen.app` |
> | 3 | Una dirección de **rol** que se **monitoriza**, con respuesta ≤30 días | `openlen.com` **no tiene MX**: no puede recibir correo. `ops@openlen.com` sólo se usa para ACME (saliente) | `dig +short MX openlen.com` → vacío |
> | 4 | **Contacto de abuso accesible** en el sitio, con URL | No existe: `/abuse`, `/legal`, `/contact`, `/es/contacto`, `/es/privacidad`, `/es/terminos` → 404 | `curl -o /dev/null -w '%{http_code}'` sobre cada una |
>
> El **1** es el que manda: no se arregla con papeleo. Los otros tres sí
> (renovar el dominio, poner MX o un buzón de rol que reciba, y publicar una
> página de abuso), pero sin el 1 no sirven de nada.
>
> ⚠️ Y del propio template, dos avisos que conviene tener presentes antes de
> mandarlo algún día:
> * La PSL dice **explícitamente** que es inapropiado usarla para esquivar
>   límites de terceros (Cloudflare, Let's Encrypt). Nuestro motivo es
>   aislamiento de origen en el navegador, que es de los legítimos — pero hay
>   que decirlo así y afirmar que no es lo otro. Aquí es fácil de sostener:
>   `*.openlen.app` se sirve con **un único certificado comodín** por DNS-01, así
>   que no hay emisión por subdominio y por tanto ningún límite de LE que
>   esquivar.
> * **El rollback es prácticamente irreversible.** Los voluntarios lo tratan con
>   la prioridad más baja y no controlan cuándo refrescan los navegadores. Una
>   entrada equivocada se queda puesta un tiempo indefinido.
>
> Lo bueno, también medido: **nadie pone cookies en `.openlen.app`** (0
> `set-cookie` en una página publicada y en `/api/chat/*`), así que la
> consecuencia principal de entrar en la PSL —que deja de poder ponerse una
> cookie en el dominio registrable— **hoy no cuesta nada**.

---

## Por qué querríamos esto (el resumen en una línea)

Hoy `a.openlen.app` y `b.openlen.app` comparten dominio registrable, así que el
navegador las trata como **same-site entre sí**: la página de un usuario y la de
otro. El corte a `.app` del 2026-09-10 (commit `61cec120`) resolvió
página↔aplicación; la entrada en la PSL es lo único que resuelve
página↔página. Es la otra mitad de lo que hace Vercel con `vercel.app`.

---

# ↓↓↓ CUERPO DEL PR (en inglés, como pide el proyecto) ↓↓↓

### Checklist of required steps

* [ ] Description of Organization
* [ ] Robust Reason for PSL Inclusion
* [ ] DNS verification via dig
* [ ] Each domain listed in the PRIVATE section has and shall maintain at least two years remaining on registration, and we shall keep the `_psl` TXT record in place in the respective zone(s).
      <!-- BLOQUEADO (2): caduca 2027-08-24. Renovar a >= 2028-09 antes de marcar. -->

__Submitter affirms the following:__

* [x] We are listing *any* third-party limits that we seek to work around in our rationale
 - None. See rationale: `*.openlen.app` is served from a single wildcard certificate obtained via DNS-01, so no per-subdomain issuance occurs and no Let's Encrypt or Cloudflare limit is involved.
* [x] This request was _not_ submitted with the objective of working around other third-party limits.
* [ ] The submitter acknowledges that it is their responsibility to maintain the domains within their section.
      <!-- Requiere el buzón de rol del punto (3). -->
* [ ] The Guidelines were carefully _read_ and _understood_, and this request conforms to them.
* [ ] The submission follows the Guidelines on formatting and sorting.
* [ ] A role-based email address has been used and this inbox is actively monitored with a response time of no more than 30 days.
      <!-- BLOQUEADO (3): openlen.com no tiene MX. -->

**Abuse Contact:**

* [ ] Abuse contact information (email or web form) is available and easily accessible.
      <!-- BLOQUEADO (4): no existe la página. -->

  URL where abuse contact or abuse reporting form can be found:
  `https://openlen.com/abuse`  <!-- POR CREAR -->

---

* [ ] *Yes, I understand*. I could break my organization's website cookies and cause other issues, and the rollback timing is acceptable. *Proceed anyway*.

## Description of Organization

OpenLen is an open-source (AGPLv3) landing-page builder. A person describes the
page they want, picks a template, or pastes their own HTML; they edit it in the
browser and publish it. Each published page is served as static HTML from a
subdomain of the namespace in this request — `<name>.openlen.app` — so every one
of our users operates a distinct subname that we do not control the contents of.
We are not a DNS provider or a registrar; hosting user-authored pages on
subnames is the core of what the product does.

The service is self-hosted on a single server behind Cloudflare; published pages
are written to disk and served directly by Caddy, with a small number of
first-party endpoints (form submissions, an analytics beacon, a chat widget)
proxied to the application on the same hostname.

I am the sole engineer on the project and its operator, submitting on behalf of
the organization. I am responsible for the DNS zone in which the `_psl` record
would be maintained.

**Organization Website:**
https://openlen.com

## Reason for PSL Inclusion

**Cookie and origin isolation between mutually untrusted user sites.** Every
`<name>.openlen.app` subname hosts HTML authored by a different person, and that
HTML may contain their own JavaScript. Because `openlen.app` is not currently a
public suffix, all of those subnames share one registrable domain, so browsers
treat any two of our users' pages as same-site with each other. That makes a
cookie set on `.openlen.app` by one user's page readable and settable by every
other user's page, and it means `SameSite=Lax` cookies are sent on navigations
between them. We would like the browser to enforce the boundary that our users
reasonably assume is already there, rather than relying on our own
hand-maintained CSP to approximate it.

We deliberately moved user content off our application's registrable domain
first, as the necessary precondition: until 2026-09-10 published pages were also
reachable at `<name>.openlen.com`, the same registrable domain as the dashboard
at `openlen.com`. That door is now closed and user content exists only under
`openlen.app`, which serves no application surface of its own. A PSL entry is
the remaining step, and the only one that addresses isolation *between* our
users rather than between our users and us.

**This request is not an attempt to work around any third-party limit.** We
serve `*.openlen.app` from one wildcard certificate issued via DNS-01, so we
perform no per-subdomain certificate issuance and are nowhere near any Let's
Encrypt rate limit; a PSL entry would not change our issuance pattern at all.
Likewise we are not seeking to alter any Cloudflare per-zone behaviour. The only
outcome we are asking for is the browser-level site boundary.

We understand and accept the consequence that no cookie can be set on
`openlen.app` itself once the entry propagates. We verified that nothing in the
product does so today: a published page and its first-party endpoints return no
`Set-Cookie` at all, and our application's own session cookies live on
`openlen.com` with the `__Host-` prefix, which is host-only by browser
enforcement and therefore unaffected.

**Number of THOUSANDS of distinct users this request is being made to serve:**

<!-- BLOQUEADO (1). Hoy: 0,008 mil (8 usuarios con subnombre publicado; 31
     cuentas registradas), medido en producción el 2026-09-10. La guía pide
     2.000-3.000 como mínimo, o sea 2-3 mil. NO rellenar ni enviar hasta que la
     cifra real lo alcance; inflarla o contar visitantes sería exactamente lo
     que el template excluye. -->

## DNS Verification

```
dig +short TXT _psl.openlen.app
"https://github.com/publicsuffix/list/pull/XXXX"
```

---

# La entrada, y dónde va exactamente

Sección **PRIVATE**, ordenada alfabéticamente por el nombre de la organización
del comentario. `OpenLen` cae **entre `OpenHost` y `OpenResearch GmbH`**
(comprobado el 2026-09-10 contra la lista descargada: líneas 15151 y 15157).

Formato copiado de una entrada equivalente y vigente (`netlify.app`, línea
14871): dos líneas de comentario y el dominio, sin espacios al final.

```
// OpenLen : https://openlen.com
// Submitted by <nombre> <dirección de rol que reciba>
openlen.app
```

⚠️ La dirección tiene que ser **de rol** (`security@`, `ops@`, `abuse@`), no
personal — el template lo pide expresamente. Y tiene que **recibir**: hoy
`openlen.com` no tiene MX, así que esto es el punto (3) de la cabecera.

# El registro `_psl`, y su orden

El TXT **apunta al PR**, así que sólo puede ponerse **después** de abrirlo, con
el número ya asignado. La secuencia es:

1. Abrir el PR con este cuerpo.
2. Crear en la zona `openlen.app` el TXT `_psl.openlen.app` con el valor
   `https://github.com/publicsuffix/list/pull/<N>`.
3. Pegar la salida de `dig +short TXT _psl.openlen.app` en la sección DNS
   Verification del PR.
4. Dejar el registro puesto **mientras se quiera seguir en la lista**: su
   ausencia es motivo de retirada.

Para el paso 2 hace falta un token de Cloudflare con `DNS:Edit` en la zona
`openlen.app`. El token que hay en la caja hoy sólo alcanza a `openlen.com` y no
tiene ni lectura de DNS (comprobado: `Authentication error` en el endpoint de
`dns_records`).
