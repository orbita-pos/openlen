# Len 3.0 — estado y operación de entregables

Implementación en `len-3.0`. **23/10/2026: la aceptación Linux pasó 22/22 EN LA
CAJA** (con su Docker, su kernel y el usuario del worker; ver «Encenderlo en la
caja», abajo). El encendido en producción sigue esa sección; la aceptación real
del pedido completo desde el chat es lo último.

## Procesos y archivos

- Next autoriza, edita fuentes y encola trabajos. No renderiza código generado.
- El worker separado reclama trabajos mediante lease/fencing y publica archivos
  privados sólo después de guardar y verificar sus bytes.
- El servidor de vista previa escucha únicamente en loopback. Un proxy dedicado
  debe publicarlo en otro hostname, nunca bajo una ruta del sitio autenticado.
- El contenedor de render recibe un paquete por stdin y un directorio temporal
  vacío. No recibe credenciales, conexión de red ni el socket Docker.
- Guardar la base y el almacenamiento privado fuera del directorio de releases.
  Un reemplazo del standalone no debe borrarlos ni quitar pausas de proyectos.

`npm run artifacts:bundle` prepara `artifacts/worker.mjs`, `preview.mjs`, módulos
nativos y archivos auxiliares en `.next/standalone`. `artifacts/install.json`
enumera los archivos trazados. No sustituye el build de Next ni copia archivos
estáticos/public automáticamente.

Desde la raíz del standalone, comprobar sin base ni proveedor:

```sh
node artifacts/worker.mjs --verify-install
```

La comprobación incluye compilación con el compilador existente, objetos nativos
PPTX, runtime GSAP y carga de la biblioteca nativa de imágenes. El campo
`renderContainerVerified: false` es deliberado: instalar módulos no prueba Linux,
LibreOffice ni renderizado aislado. Repetir en el SO de destino, con sus binarios
nativos. El paquete probado en Windows no sirve como binario Linux.

## Configuración explícita

| Variable | Uso |
| --- | --- |
| `OPENLEN_ARTIFACTS=1` | Habilitación; ausente mantiene la función apagada. |
| `DATABASE_URL` | Postgres por TCP; migración aditiva antes de habilitar. |
| `OPENLEN_ARTIFACTS_DIR` | Directorio privado persistente, fuera de `public`. Obligatorio en producción si no se usa R2 privado. |
| `R2_ARTIFACTS_BUCKET` | Bucket privado dedicado; requiere las credenciales R2 existentes, sin URL pública. |
| `OPENLEN_ARTIFACT_RENDERER_IMAGE` | Imagen local verificada; el worker usa `--pull never`. |
| `OPENLEN_ARTIFACT_MOTION_VERIFIED=1` | Abrir sólo tras la aceptación Linux de motion, no por la prueba Windows. |
| `OPENAI_API_KEY` | Sólo worker, para generación de imágenes. |
| `OPENLEN_ARTIFACT_IMAGE_MODEL` | Por defecto `gpt-image-2`. Un modelo sin tarifa conocida conserva coste desconocido. |
| `OPENLEN_ARTIFACT_IMAGE_CENTICREDITS` | Precio comercial explícito; sin valor no se registra el motor pagado. |
| `OPENLEN_ARTIFACT_RENDER_CENTICREDITS` | Política explícita, también requerida; no hay precio implícito. Los renders locales actuales no hacen una llamada externa pagada. |
| `NEXT_PUBLIC_SITE_URL` | Origen canónico de la app. |
| `OPENLEN_ARTIFACT_PREVIEW_ORIGIN` | Otro hostname con HTTPS, sin ruta, query ni fragmento. |
| `OPENLEN_ARTIFACT_PREVIEW_PORT` | Puerto loopback del preview; por defecto 3012. |
| `INARIWATCH_DSN` | Monitoreo cloud opcional; el inicio ya carga captura automática. |

La app sólo anuncia tipos configurados. No habilitar una capacidad de la que
falten renderer, proveedor o política. Mantener las claves del proveedor fuera
del proceso preview. El preview necesita DB y lectura del storage privado;
sus tickets requieren escritura en DB.

El despliegue del preview debe usar un subdominio **del mismo sitio** que la app
para que la cookie `SameSite=Strict` funcione dentro del iframe. Por ejemplo,
`app.example.com` y `preview.example.com`; nunca el mismo hostname. Un dominio
registrable distinto necesita otra estrategia de sesión y su propia aceptación
de cookies de terceros. Verificar en los navegadores objetivo antes de activar.

No usar `PrivateTmp=true` para el worker cuando Docker comparte el daemon del
host: los bind mounts deben apuntar a rutas visibles por ese daemon. Preparar un
`TMPDIR` privado del usuario del worker y probar permisos con el UID/GID real.

## Encenderlo en la caja (23/10/2026)

Medido en la caja (Hetzner, 3 vCPU, 3,8 GB): aceptación **22/22**, sin
contenedores ni temporales sobrantes; pico de un render 465 MiB (video), el de
120 s tardó 341 s; producción durante la prueba, ≥2,0 GB disponibles, swap igual
y la web sin errores. Renders en la misma caja, de uno en uno.

**Quién es quién.** `openlen-artifacts` (grupo `docker` = root a efectos
prácticos) es el worker y el ÚNICO que escribe el almacén. Next
(`openlen-deploy`) y la vista previa (`openlen-preview`) lo LEEN por el grupo
`openlen-artifacts`: el almacén escribe `0640`/`0750` cuando su carpeta deja
leer al grupo (`storageModes`, `lib/artifacts/private-storage.ts`), y privado
(`0600`/`0700`) cuando la crea el propio código.

**Una vez, como root en la caja:**

```sh
NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --groups docker openlen-artifacts
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid openlen-artifacts openlen-preview
usermod -aG openlen-artifacts openlen-deploy     # Next lee las descargas; efecto al reiniciar la app
install -d -m 2750 -o openlen-artifacts -g openlen-artifacts /var/openlen/artifacts
install -d -m 0700 -o openlen-artifacts -g openlen-artifacts /var/openlen/artifacts-tmp
```

La imagen: la VERIFICADA, no una reconstrucción (`docker save
openlen/artifact-renderer:2 | gzip` donde pasó la aceptación → `scp` →
`gunzip -c | docker load`) y comprobar que el ID es el mismo. Después, la
aceptación en la caja desde una máquina con el repo (en Git Bash,
`MSYS_NO_PATHCONV=1` y la carpeta de evidencia como `C:/…`):

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-linux-acceptance.ts \
  --evidence <carpeta nueva> --image openlen/artifact-renderer:2 \
  --ssh openlen --run-as openlen-artifacts --tmpdir /var/openlen/artifacts-tmp
```

🔴 **Con el worker encendido, PARARLO antes** (`systemctl stop openlen-artifacts-worker`, mirando que no haya
trabajos en cola) y arrancarlo al acabar: en cada vuelta `reconcileArtifactContainers` quita todo contenedor
`openlen-artifact-*` que no sea de un trabajo activo, y los de la aceptación no lo son. Con él encendido, cada caso
sale `bridge_error` a los ~3 s («…/result.json: ENOENT»). Medido el 23/10. El PPTX y el PDF cambian de una corrida a
otra del mismo código (llevan su fecha); el HTML y los PNG no.

En `/etc/openlen/openlen.env` (Next y el worker lo leen; la vista previa recibe
un subconjunto que el deploy genera en `/etc/openlen/artifacts-preview.env`):

```sh
NEXT_PUBLIC_SITE_URL=https://openlen.com
OPENLEN_ARTIFACTS=1
OPENLEN_ARTIFACTS_DIR=/var/openlen/artifacts
OPENLEN_ARTIFACT_RENDERER_IMAGE=openlen/artifact-renderer:2
OPENLEN_ARTIFACT_MOTION_VERIFIED=1
OPENLEN_ARTIFACT_AUDIO_VERIFIED=1
OPENLEN_ARTIFACT_IMAGE_CENTICREDITS=500
OPENLEN_ARTIFACT_RENDER_CENTICREDITS=0
OPENLEN_ARTIFACT_AUDIO_CENTICREDITS=25
OPENLEN_ARTIFACT_PREVIEW_ORIGIN=https://preview.openlen.com
```

`NEXT_PUBLIC_SITE_URL` hace falta EN EJECUCIÓN: `previewConfig` y la
comprobación de origen de las rutas (`lib/artifacts/routes.ts`) lo leen de un
parámetro, no del build; todos los demás que lo leen caen ya en
`https://openlen.com`, así que no cambia nada más. Los servicios
(`infra/app/openlen-artifacts-{worker,preview}.service` y la línea de
`needrestart-openlen.conf`) se instalan con `install-app.sh` y se habilitan con
`systemctl enable openlen-artifacts-worker openlen-artifacts-preview`.

**El deploy** empaqueta los dos (`artifacts:bundle`, paso 3), comprueba
`worker.mjs --verify-install` en la carpeta de staging antes del swap (paso 6.6)
y, tras el swap, rehace el entorno de la vista previa y reinicia los dos, sólo si
están habilitados. Caddy publica la vista previa en `preview.openlen.com` (bloque
propio; el DNS lo cubre el comodín de `*.openlen.com` y `preview` está reservado
como subdominio).

**Apagarlo:** quitar `OPENLEN_ARTIFACTS=1` de `openlen.env` y reiniciar
`openlen-app`; el worker y la vista previa contestan «disabled» y se paran en
el próximo reinicio (`systemctl restart openlen-artifacts-worker
openlen-artifacts-preview`).

## Diagnóstico y recuperación

Con configuración habilitada y migrada, desde el standalone:

```sh
node --env-file=/ruta/privada/artifacts-worker.env artifacts/worker.mjs --status
```

Devuelve conteos actuales por tipo/estado, espera de la cola y percentiles p50/p95
de latencia total de trabajos terminados en las últimas 24 horas. Esa latencia
incluye espera y reintentos: no mide CPU de render. También muestra códigos de
fallo agregados, coste externo conocido, número de intentos con coste desconocido
y cargos confirmados. No devuelve prompts, consultas, actores, rutas privadas,
IDs de proyectos ni tokens de fencing. Ejecutarlo como operador; no publicarlo
como endpoint anónimo. La memoria máxima de contenedores requiere medición Linux
separada y no se infiere de la memoria de este comando.

El worker registra por trabajo únicamente ID, estado y código. Los diagnósticos
de compilación se guardan acotados para inspect autorizado, no en esos logs.

- Lease: 30 segundos; heartbeat: 10 segundos. Reiniciar no publica un resultado
  viejo ni conserva autoridad del worker anterior.
- Antes de admitir render, reconciliar contenedores con la etiqueta administrada
  y el token del lease. Un proceso muerto puede dejar vivo el contenedor.
- Cancelar elimina el contenedor exacto. Si Docker no confirma su ausencia,
  conservar el directorio temporal, marcar `renderer_cleanup_unknown` y detener
  el worker. Al reiniciar se vuelve a reconciliar antes de reclamar trabajo.
- Si una llamada externa pudo cobrarse y no se conoce el resultado, queda en
  `needs_attention`; no repetir automáticamente el proveedor. Reconciliar el
  recibo y el ledger antes de decidir una nueva operación.
- Una respuesta perdida al COMMIT no prueba rollback. Se consultan los estados
  persistidos y se conservan objetos para reconciliación, sin borrar un resultado
  que pudiera estar publicado.
- Corregir crea otra revisión. Las piezas ya listas y los índices de descarga
  existentes permanecen; las dependencias apuntan a revisiones exactas.
- El cursor de eventos puede avanzar aunque la página no contenga eventos
  visibles. Usar el `cursor` retornado; avanzar no equivale a marcarlos leídos.
- `artifactProjectControls.paused` es persistente. El ensayo de selección pausa
  sus proyectos antes de hablar con el modelo; no quitar esas pausas al reiniciar
  o desplegar.
- El refresh live va por un MessagePort del documento opaco al padre autenticado.
  El padre fija artefacto, revisión y datasets permitidos; el iframe no recibe
  cookies, consultas SQL ni parámetros de consulta. Una navegación del iframe no
  recibe respuestas anteriores mediante su WindowProxy. Al desmontar, cerrar el
  puente. La UI deberá conectar `connectArtifactLivePreview` al abrir una vista.
- `window.lenLive.refresh(id)` reemplaza las filas de `window.lenData`, actualiza
  la procedencia y emite `len:data`. El dashboard debe volver a leer las filas al
  manejar ese evento. Descargar HTML conserva el snapshot, sin este puente.
- Una captura de proyecto parte de archivos públicos seleccionados, guardados
  con sus hashes en `project-source/`. El render comprueba esa copia, sin leer
  la app actual. La fuente se ejecuta en un navegador limpio y sin red, datasets,
  env ni sesión. No equivale a capturar una pantalla autenticada de un cliente.
- Para motion, `create_artifact` admite `freeze_source:true` y `source_paths`;
  `motion.json` admite hasta cuatro `captures:[{id,entry}]`. Sus imágenes se usan
  como `asset:capture:<id>` y se guardan como PNG reutilizables, con un máximo
  conjunto de 4 MiB. La fuente y composición comparten el límite de 5 MiB de la
  revisión. Los módulos locales se compilan por la misma ruta existente.
- Una corrección del origen usa `render_artifact` sobre el mismo ID, revisión
  actual y `refresh_source_paths` explícito. Crea otra revisión antes de encolar;
  no sustituye una fuente sellada ni genera una sexta identidad. Los reintentos
  ordinarios omiten ese argumento; un conflicto requiere inspect.

## Ensayos preparados y límites de la evidencia

`npm run bench:len:artifacts` es dry-run por defecto. Reutiliza la ruta real de
Len-Bench, brain y recorder. El modo pagado exige `--yes --budget-usd <límite>`,
cuenta de evaluación y servidor local dedicado en 3007. Falla antes del primer
turno si falta alguno de los cuatro tipos. La prueba de selección no ejecuta los
renders: sus proyectos quedan pausados. El informe separa `selectionPassed` de
`formatsVerified: false`. El caso de corrección de un resultado real terminado
se acepta en el ensayo completo, no inventando una pieza previa en el corpus.

Ya se probó localmente el pedido estructural de cinco identidades, dependencia
de imagen fijada, cancelación parcial, fallo/corrección de video, reconexión de
servicios y conservación de archivos listos. Sus adaptadores son fixtures:
**no es evidencia de selección del modelo ni de cinco formatos reales.**

El puente live se probó en navegador con servicios HTTP y SQL de fixture: total
200 -> 400 y filtro Norte -> 240, procedencia actualizada, cero errores de consola,
origen opaco y acceso a cookies/documento padre bloqueado. La prueba usa la
implementación real del puente y refresh, pero un contexto de autorización fijo
y datos sintéticos. No equivale al ensayo HTTP de la sesión Next del producto.
El fixture repetible es `scripts/artifact-live-preview-fixture.ts`; iniciarlo con
el mismo preload de captura automática que el worker. No hace llamadas pagadas.

La captura de origen se probó con un proyecto de inventario funcional en PGlite:
el loader real congeló HTML/TS/CSS, la app cambió a v2 y la captura conservó v1.
Su botón funcionó (21 -> 24). El adaptador `renderMotion` incorporó ese PNG real
en una composición de un segundo: 30 cuadros, seek reproducible, H.264, sin
audio y decodificación completa. Se usó el navegador disponible y el encoder
del producto; esto no verifica la imagen Docker ni los límites Linux. El fixture
repetible de fuentes es `scripts/artifact-project-capture-fixture.ts`.

La primera composición de este fixture fue rechazada por no fijar el estado
visual inicial de GSAP. Se corrigió el fixture con estado inicial explícito y
ticker dormido; la comprobación de determinismo se mantuvo estricta. No se
publicó el resultado fallido ni se relajó la comparación.

Pendientes antes de la aceptación completa:

1. Host Linux elegido; build/ejecución de la imagen Docker, aislamiento,
   límites 2 CPU/2 GiB, cancelación y caída real del daemon/worker.
2. LibreOffice: abrir/renderizar el PPTX nativo, PDF, todas sus páginas y revisar
   fuentes, overflow y fidelidad. No basta con el ZIP ni el HTML de slides.
3. Motion: prueba Linux reproducible, peor caso de 120 segundos, tiempos y memoria.
4. Verificar capturas con proyectos reales que usan el catálogo y recursos
   remotos. El compilador ya empaqueta React/Recharts y las librerías del catálogo
   local con hashes verificados, y conserva el catálogo de la fuente congelada.
   Rechaza npm arbitrario no preparado, recursos remotos y archivos ausentes.
   No prometer captura universal ni una app basada
   en API que pueda funcionar sin su red/datos.
5. Integrar el puente live en la futura UI y probarlo con la sesión Next real.
   El endpoint owner-only y el transporte opaco ya están implementados y probados
   por separado, incluida otra revisión sin alterar los snapshots anteriores.
6. Precio comercial y presupuesto pagado aprobados; imágenes reales, reconciliación
   del coste y selección/corrección con el modelo real en app y página.
7. Build standalone general en el host de destino. En Windows se compiló y se
   generaron las 4869 páginas, pero la copia final tuvo errores EPERM. El bundle
   separado del worker sí se probó fuera del checkout.
8. Revisión final de rama; después UI, traducciones y ensayo desde el chat.

No se ejecutaron migraciones sobre la base real, llamadas pagadas, instalación
Docker, push ni deploy como parte de estas verificaciones locales.

## Ampliación de autoría visual (18/10/2026)

Los entregables comparten el catálogo de apps existente y verificado, sin red ni
instalación npm durante el render. `dashboard.json.catalogo` fija su versión
(2026-11 por defecto); las capturas conservan la de su app. El bundle incluye
manifiestos y módulos de producción, sin catálogo de desarrollo ni test-kit.
El instalador comprueba React/Recharts fuera del checkout. El CSS local importado
y Tailwind 3 se hornean mediante el compilador compartido con publicación;
no se ejecuta una configuración Tailwind del usuario. Las apps normales mantienen
su comportamiento; el modo inline tiene su propia clave de caché.

Slides conserva `deck.json` v1. Los decks nuevos son v3 (20/10/2026), el formato
de Claude Slides: `deck.json` es el índice (`title`, `order`, `sections`) y cada
diapositiva es `slides/<id>.html`, una sola `<section>` de 1920×1080 con estilos en
línea y notas en `<aside>`. El vocabulario que se vuelve objeto de PowerPoint está
CERRADO (`lib/artifacts/adapters/slides/subset.ts`): etiquetas de texto, listas,
tablas, cajas pintadas (color, degradado, borde de un estilo y un color, radio,
sombra, opacidad, rotación), imágenes guardadas y `<svg>`. Lo de fuera se rechaza al
GUARDAR la diapositiva con línea:columna y el cambio permitido más cercano. La
maquetación (flex, grid, margin, z-index, em, calc, variables CSS) es libre: la
resuelve el navegador. La v2 (HTML libre + `data-len-raster`) se retiró.

El paquete `slides-layout` mide cada diapositiva en el orden de pintado de CSS
(`tools/artifact-renderer/slide-layout.mjs`): una caja de texto por bloque con sus
tramos, formas, una franja por lado cuando los grosores difieren, tablas y listas
nativas, imágenes con su recorte de `object-fit`, y cada `<svg>` como imagen a 2×
sobre fondo transparente. El texto que no cabe encoge hasta el 60 % y queda en la
evidencia. `lib/artifacts/adapters/slides/native.ts` lo escribe con PptxGenJS y
añade al XML lo que PptxGenJS no tiene: degradados, recorte/radio/contorno de
imágenes y transiciones. La diapositiva mide 13,33×7,5 in (1 pt = 2 px).

La imagen `openlen/artifact-renderer:2` añade fuentes para las diapositivas: Inter,
Roboto, Open Sans, Lato, EB Garamond, JetBrains Mono, y Carlito/Caladea, que miden
igual que Calibri/Cambria (el PPTX las nombra como Calibri/Cambria).

La base del Dockerfile va fijada por digest (`node:22-bookworm-slim@sha256:c3de60bf…`, 21/10/2026): reconstruir
con ella da la misma imagen verificada (`af974bbb102a`). Los paquetes de Debian NO se fijan a propósito: este
Chromium dibuja HTML que no es nuestro y tiene que recibir las actualizaciones de seguridad, y snapshot.debian.org
no sirve de forma fiable el archivo de seguridad (503 al probarlo). Lo reproducible es la imagen: producción usa
una imagen local verificada (`--pull never`) y una reconstrucción sólo se usa tras pasar la aceptación Linux. Las
versiones de la imagen verificada están anotadas en el propio Dockerfile.

Dashboards (20/10/2026): d3 7.9.0 es el global `d3` de cada dashboard
(`public/artifact-vendor/d3-7.9.0/`, del `dist/d3.min.js` del paquete npm, ISC; su
sha256 está fijado en `lib/artifacts/adapters/dashboard/d3.ts`). Un CSV/TSV/JSON del
propio dashboard nombrado en `datasetIds` es un conjunto de datos de escenario, con
`title`/`description` en `dashboard.json.datasets`. Tras pintar, el renderer revisa
la salida: un `NaN`/`undefined`/`Infinity` visible detiene la exportación
(`dashboard_output_invalid`); una gráfica vacía, etiquetas encimadas o cortadas y una
marca `data-source`/`data-field` que no es su dato quedan como `output:*` en la
evidencia.

Prueba local real: dashboard React/Recharts200->120 con filtro, CSS/Tailwind
compilado48px, cero errores JS. Deck HTML de2slides con estilos distintos,
21objetos medidos, un componente degradado raster, texto/negritas/cursivas/notas
y formas nativas verificadas en el ZIP; origen null, cookies/padre bloqueados.
Esto no prueba fidelidad Office ni ejecución Docker. Fixture repetible:
`scripts/artifact-breadth-fixture.ts`, con el preload de captura automática y
directorio de salida explícito. No llama al modelo ni a proveedores.
