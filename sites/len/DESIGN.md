# len.openlen.com — la casa de Len

**Fecha:** 2026-09-10 · **Estado:** diseño aprobado por partes en la sesión, pendiente de revisión escrita
**Maquetas:** `.superpowers/brainstorm/5027-1789087599/content/` (`portada-b-v3.html`, `articulo.html`)

---

## 1 · Qué es y para qué

Una web propia de **Len**, el agente de OpenLen, en `len.openlen.com`, que habla de él en
profundidad al estilo en que anthropic.com habla de sus modelos: qué es, qué puede hacer,
cómo trabaja, qué hemos aprendido construyéndolo y qué promete.

**Audiencia:** usuarios curiosos y, sobre todo, **inversores**. No vende una función: vende
**confianza en cómo está hecho Len**.

**La tesis de toda la web:** *un agente que enseña su trabajo*. Por eso cada cifra es real,
medida y enlazada a la prueba que la sostiene, y cada artículo cuenta también lo que salió
mal y lo que sigue abierto. La web se gana el derecho a decir «Len no miente» siendo ella
misma verificable.

**Éxito de la v1:** portada + 3 artículos + principios, en inglés y español, publicados en
`len.openlen.com`, con todas las puertas de calidad en verde (§7) y cero afirmaciones sin
fuente pública.

## 2 · Decisiones tomadas (y por qué)

| Decisión | Elegido | Por qué |
|---|---|---|
| Dónde vive | `len.openlen.com` | Una dirección propia para enseñar a inversores. |
| Idiomas | inglés **y** español, con selector | EN para capital y prensa; ES es la voz natural y la de los primeros usuarios. |
| Secciones v1 | portada · research · principios | «Cómo funciona» va dentro de la portada; el changelog espera a que haya ritmo de versiones. |
| Tecnología | **A+**: proyecto Next.js **propio** en `sites/len/`, exportado **estático** | Medido el 2026-09-10: anthropic.com = Webflow (portada) + Next.js (news) con Sanity; openai.com = Next.js en Vercel con Contentful. **Las dos separan la web del producto y la pre-renderizan.** A+ hace lo mismo sin acoplarse a `deploy.ps1`. |
| CMS | **git** (MDX en el repo) | Un solo autor. Sanity/Contentful son sobredimensionados hoy y se pueden añadir después sin rehacer nada. |
| Dirección visual | **B · Revista científica** | Titulares en serif (Newsreader) con cursiva, texto en sans (Inter). Elegida entre tres maquetas. |
| Imágenes | tres pinturas del usuario | `primera` (amanecer, 21:9) → héroe; `segunda` (atardecer, 21:9) → tarjeta de Len; `tercera` (detalle, 3:2) → portada de artículo y frase de misión. |

Descartadas: meterla dentro de la app de Next (B — justo lo que ellos no hacen, y cada errata
pasaría por `deploy.ps1`); hacerla con el propio OpenLen (C — fuerza el producto y sirve
contenido de `.app` bajo `.com`, contra el corte del 2026-09-10).

## 3 · Arquitectura

```
sites/len/
  package.json          next 15.5.23 · react 19 · tailwindcss 3.4 (las MISMAS versiones que la app)
  next.config.mjs       output: "export" · trailingSlash: true · images: { unoptimized: true }
  tsconfig.json         propio; nada de la app lo importa ni al revés
  app/
    [lang]/page.tsx                 portada
    [lang]/research/page.tsx        índice de research
    [lang]/research/[slug]/page.tsx artículo
    [lang]/principles/page.tsx      principios
    [lang]/layout.tsx               <html lang>, fuentes, nav, pie
    not-found.tsx                   404 propio
  content/
    research/<slug>.en.mdx · <slug>.es.mdx
    principles.en.mdx · principles.es.mdx
  i18n/  en.ts · es.ts              textos de la interfaz (nav, pie, etiquetas)
  components/  Cifra · Fuente · Figura · Abierto · EstadoPrincipio · TarjetaLen
               + maquetación: Nav · Pie · SelectorIdioma · IndiceArticulo
  scripts/  check-content.mjs · check-links.mjs · images.mjs · deploy.sh
  public/img/  imágenes procesadas por images.mjs (sharp → AVIF/WebP, 1x y 2x) — el export
               estático no optimiza imágenes (next/image va con `unoptimized: true`)
```

- **Rutas:** `/en/`, `/es/`, `/{lang}/research/`, `/{lang}/research/{slug}/`,
  `/{lang}/principles/`. `generateStaticParams` sobre `lang ∈ {en, es}` y los slugs de
  `content/`. `trailingSlash` para que cada ruta sea una carpeta con `index.html`.
- **La raíz `/`** no la resuelve Next (un export estático no redirige): la resuelve **Caddy**
  por `Accept-Language` (§4).
- **Contenido:** MDX con frontmatter (`title`, `dek`, `date`, `category`, `topic`, `cover`,
  `readingMinutes`). Los componentes propios se usan dentro del MDX.
- **Aislamiento de la app:** añadir `"sites"` al `exclude` de `tsconfig.json` raíz (hoy
  incluye `**/*.ts` y sólo excluye `node_modules` e `infra/status-worker` — sin esto, el
  `npm run typecheck` de la app intenta compilar `sites/len` y falla). `next lint` de la app
  sólo mira sus carpetas por defecto; vitest usa lista blanca: no les afecta.

### Componentes que sostienen la tesis

- **`<Cifra valor="1/12 → 10/12" commit="2d0c474f">`**: un número con su fuente. `commit`
  es **obligatorio**; renderiza un enlace a
  `https://github.com/orbita-pos/openlen/commit/<hash>`.
- **`<Fuente commit|ruta>`**: una cita de fuente en línea (monoespaciada).
- **`<Figura>`**: tabla o gráfico con pie de figura y fuente.
- **`<Abierto>`**: la caja «Lo que sigue abierto». **Obligatoria en todo artículo** (lo
  comprueba §7).
- **`<EstadoPrincipio estado="vigilado|construccion|medicion">`**: el estado real de cada
  principio.
- **`<TarjetaLen>`**: la tarjeta de la portada (§5.1).

## 4 · Infraestructura

**Caddy** (`infra/caddy/Caddyfile`, fuente de verdad; en la caja `/etc/caddy/Caddyfile`):
un bloque `len.openlen.com` **antes** del comodín `*.openlen.com` (Caddy elige el host más
específico). Borrador:

```caddy
len.openlen.com {
	tls /etc/letsencrypt/live/openlen.com/fullchain.pem /etc/letsencrypt/live/openlen.com/privkey.pem
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
	# La raíz se decide por idioma y NUNCA se cachea: con la cabecera pública de
	# @doc, Cloudflare guardaría en el borde la redirección del primer visitante
	# (p. ej. a /es/) y se la serviría a todos — Cloudflare no separa por
	# Accept-Language. Por eso @doc excluye "/" y la raíz lleva no-store.
	@root path /
	handle @root {
		header Cache-Control "no-store"
		@es header_regexp Accept-Language ^\s*es
		route {
			redir @es /es/ 302
			redir * /en/ 302
		}
	}

	@assets path *.css *.js *.avif *.webp *.png *.jpg *.svg *.woff2 *.ico
	header @assets Cache-Control "public, immutable, max-age=31536000"
	@doc {
		not path /
		not path *.css *.js *.avif *.webp *.png *.jpg *.svg *.woff2 *.ico
	}
	header @doc Cache-Control "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400"

	handle {
		root * /var/www/len-site/current
		try_files {path} {path}/index.html
		file_server
	}

	# `next build` con output:"export" genera /404.html en la raíz del sitio.
	handle_errors {
		@notfound expression {http.error.status_code} == 404
		handle @notfound {
			root * /var/www/len-site/current
			rewrite * /404.html
			file_server {
				status 404
			}
		}
	}
}
```

`route` y no dos `redir` sueltos: dentro de `route` el orden es literal; fuera, Caddy
reordena directivas del mismo nombre y `*` podría ganarle a `@es`. `^\s*es` mira el PRIMER
idioma del navegador (`es-MX,es;q=0.9,en;q=0.8` → `/es/`; `en-US,en;q=0.9,es;q=0.8` →
`/en/`). Antes de recargar: `caddy validate` y probar las dos cabeceras con `curl -H`.

- **Certificado:** el comodín de `openlen.com` que ya tiene la caja cubre `len.openlen.com`.
- **DNS:** registro **propio** `len` A `178.156.175.171`, **proxied** — no colgar del comodín
  (lección del 2026-09-10, ver memoria `comodin-dns-openlen-com-listado`).
- **Caché de borde:** la regla de la zona `.com` ya cachea `*.openlen.com` respetando al
  origen; las cabeceras de arriba mandan.
- **Subdominio reservado:** añadir `len` a `lib/subdomain/reserved.ts`. Hoy `len` no está
  reservado y `len.openlen.app` está libre (404): cualquiera podría ocuparlo. Viaja con el
  próximo despliegue de la app; hasta entonces el riesgo es una ventana, no un agujero,
  porque el bloque de Caddy ya no redirige `len.openlen.com` a `.app`.

**Publicar** (`sites/len/scripts/deploy.sh`, siempre bajo petición explícita):
`next build` + puertas (§7) → `tar` de `out/` → `scp` → `/var/www/len-site/releases/<hash>/`
→ cambio atómico del enlace `current` → purga de la caché de Cloudflare para
`len.openlen.com` → comprobación final (§7). **Rollback:** volver a apuntar `current` a la
release anterior.

Una sola vez: bloque de Caddy (con copia fechada de `/etc/caddy/Caddyfile` y `caddy
validate` antes del `reload`), registro DNS, reserva del subdominio.

## 5 · Contenido v1

**Reglas para todo el texto**
1. Cada número sale de una medición registrada y se escribe con `<Cifra commit="<hash>">`.
2. Se cuentan las hipótesis que resultaron falsas y lo que sigue abierto.
3. **Ningún nombre de modelo ni de proveedor** (caducan; ya le pasó al post del blog).
4. Nada privado: sin nombres de clientes (Aurora → «un sitio inmobiliario»), sin costes
   internos en pesos. Los costes relativos (−38 %) sí.
5. El español se escribe en español, no se traduce del inglés.
6. **Si la medición salió de un script que no está en el repositorio público, o se publica
   el script o esa cifra no aparece.** (Caso real en la maqueta: `scratch/aislar-t4.mts`.)

### 5.1 Portada

1. **Nav:** marca (anillo Lens-O + «Len»), Research, Principios, OpenLen, ES·EN, «Prueba
   Len» → `https://openlen.com/new` (con prefijo de idioma).
2. **Héroe:** antetítulo «OpenLen · El agente»; titular *Un agente que enseña su trabajo* /
   *An agent that shows its work*; párrafo: Len construye y edita tu página, y antes de decir
   «hecho» la mira — renderiza, mide el contraste en el píxel y cuenta lo que pasó, también
   cuando falla.
3. **Imagen** `primera` a todo el ancho del contenedor.
4. **Tarjeta de Len** sobre `segunda` con velo: «Veintisiete herramientas y dos ojos». Los
   27 nombres salen de `lib/agent/catalog.ts` — **el número se comprueba en el build**
   contra el catálogo, no se escribe a mano. Grupos (suman 27):
   Mirar 1 (`mirar_pagina`, 2 modos: medir gratis / describir con visión) · Leer 3 ·
   Editar 5 · Diseñar y crear 5 · Fotos 2 · Datos y módulos 5 · Contigo 6.
5. **Cómo trabaja:** Lee · Actúa · Mira · Cuenta.
6. **Lo último:** los artículos, con fecha, tema y su cifra.
7. **Principios:** los tres primeros con su estado.
8. **Misión** sobre `tercera`: «Una página que miente es peor que una página sin terminar».
9. **Pie:** código abierto (AGPLv3), repo, status, openlen.com, idioma.

### 5.2 Research — los tres artículos de lanzamiento

Esquema fijo: el problema → cómo se midió → qué se encontró (errores propios incluidos) →
el arreglo → cifras → **lo que sigue abierto** → cómo reproducirlo.

| Artículo | Fecha | Cifras | Fuentes (verificadas públicas el 2026-09-10) |
|---|---|---|---|
| Cuando el agente decía «hecho» y no había hecho nada | 2026-08-22 | 1/12 → 10/12 (n=12 por brazo) · 3/7 → 6/7 turnos · 3 → 7 versiones | `2d0c474f` (el mensaje trae la medición) |
| Evidencia, no veredictos | 2026-09-02 | vueltas 6→10→9 → 6→3→2 · roturas reportadas 5 → 1 · coste −38 % | `616c054b` `c847fa55` `ca4fc5c8` `81b8d839` `75ef2790` `e53582f6` |
| Seis veces la misma avería | 2026-09-01 | 6 de 6 cerrados (+ dos del segundo patrón) | `d854c26a` `c288f114` `e283f46d` `4d34223e` |

El barrido exploratorio de 0–3 turnos del primer artículo **no** está en el repo (§5 regla 6).

### 5.3 Principios

Uno a uno, cada uno con: qué promete · por qué · **cómo lo comprobamos** (enlace al caso o
al test) · estado real.

| Principio | Estado | Cómo se comprueba |
|---|---|---|
| No mentir — toda afirmación descansa en un resultado observado | vigilado · 0 fallos en dos corridas | casos `tope-no-miente`, `tres-tareas-una-imposible` (`lib/agent/evals/cases.ts`) |
| Terminar el encargo — lo pedido es el entregable | en construcción | — (se dice abiertamente) |
| Una condición que otro confirma, con tope de gasto: ante la duda, para | construido, en medición | `lib/agent/objetivo/evaluar-condicion.ts`, `cerrarTurno()`; caso `propone-objetivo` (nunca corrido en real) y `telefono-en-las-cuatro` |
| Evidencia, no veredictos — nadie juzga entre el actor y el artefacto | vigilado | caso `aurora-marcador-no-es-rotura` |
| Corrige el usuario — crear no tiene bucle de reparación automática | decisión de producto | comentario en `app/api/generate/route.ts` |

## 6 · Sistema visual (dirección B)

- **Color:** crema `#F3EEE4` (fondo) · papel `#F8F4EC` (tarjetas claras) · tinta `#16140F`
  · gris `#6a645a` · línea `#dcd4c5`. El coral de OpenLen (`#FF5A36`, degradado del anillo)
  **sólo** en la marca y en las imágenes.
- **Tipografía:** titulares **Newsreader** (400, cursiva para el énfasis), texto **Inter**,
  fuentes/cifras en línea **JetBrains Mono**. Alojadas con `next/font`.
- **Retícula:** contenedor 1080 px; artículo en columna de ~680 px con índice lateral fijo
  de 200 px; en móvil, una columna y el índice se pliega.
- **Movimiento, poco y contenido:** una entrada suave del titular; nada ligado al scroll en
  la v1. Todo respeta `prefers-reduced-motion`.
- **Identidad propia:** texto, marca y composición nuestros. De la referencia se toma el
  registro (crema, serif, contención), no su marca, su texto ni su logotipo.

## 7 · Calidad

**Puertas que rompen el build** (`scripts/check-content.mjs`, `check-links.mjs`):
1. **Paridad:** cada página y artículo existe en `en` **y** `es`.
2. **Fuentes:** cada `<Cifra>`/`<Fuente commit>` apunta a un commit que existe y está en
   `origin/master` (`git cat-file` + `git branch -r --contains`).
3. **Sin modelos:** lista de nombres de modelos/proveedores prohibidos en `content/` e `i18n/`.
4. **Estructura:** todo artículo tiene `<Abierto>`; el «27» de la tarjeta coincide con el
   catálogo de `lib/agent/catalog.ts`.
5. **Enlaces:** tras el export, cada `href` interno resuelve a un fichero en `out/`.
6. `tsc --noEmit` y lint de `sites/len`.

**Objetivos medidos antes de publicar:** Lighthouse ≥ 95 en las cuatro categorías,
escritorio y móvil, portada y un artículo · héroe ≤ ~250 KB en AVIF/WebP · contraste AA.

**Comprobación tras publicar:** `/` → 302 a `/es/` o `/en/` según `Accept-Language` ·
`/en/`, `/es/`, un artículo y principios → 200 · una ruta inexistente → 404 propio · la
segunda petición → `cf-cache-status: HIT` · sin `--resolve` (lo que ve un usuario).

**SEO y compartir:** `title`/`description` por página, `hreflang` en/es + `x-default`,
canonical, `sitemap.xml`, `robots.txt`, imagen OG por artículo generada en el build, JSON-LD
`Article`.

**Analítica:** ningún script en la v1 (las analíticas de zona de Cloudflare cuentan visitas
sin cookies).

## 8 · Riesgos y preguntas abiertas

- **Resolución de las imágenes:** 1.916 px de ancho; para el héroe a 2x hacen falta ~2.160.
  Reescalar o regenerar más grande.
- **Firma de los artículos:** «Equipo OpenLen» o el nombre de Jesús — por decidir.
- **Ventana del subdominio:** `len` sin reservar hasta el próximo despliegue de la app.
- **El post del blog `the-models-behind-your-page`** dice «cuatro papeles» (el diseñador se
  retiró el 2026-09-06): es falso en público hoy. Fuera de esta web, pero hay que arreglarlo.
- **`.superpowers/brainstorm/` no está en `.gitignore`** (sólo `.superpowers/sdd/`): no
  commitear las maquetas.
- **Disco:** un segundo `node_modules` (~300 MB) en una máquina con ~25 GB libres.

## 9 · Fuera de la v1

CMS · newsletter · buscador · comentarios · modo oscuro · changelog · analítica con script ·
animaciones ligadas al scroll.
