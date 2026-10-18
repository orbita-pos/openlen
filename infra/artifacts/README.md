# Len 3.0 — estado y operación de entregables

Implementación en `len-3.0`. **No activar todavía en producción.** Los motores
tienen pruebas locales, pero el ensayo Linux y la aceptación real del pedido
completo siguen pendientes. Este documento no instala servicios ni modifica
el despliegue existente.

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

Pendientes antes de la aceptación completa:

1. Host Linux elegido; build/ejecución de la imagen Docker, aislamiento,
   límites 2 CPU/2 GiB, cancelación y caída real del daemon/worker.
2. LibreOffice: abrir/renderizar el PPTX nativo, PDF, todas sus páginas y revisar
   fuentes, overflow y fidelidad. No basta con el ZIP ni el HTML de slides.
3. Motion: prueba Linux reproducible, peor caso de 120 segundos, tiempos y memoria.
4. Congelar capturas reales de la app/página, sin sesión/datos de clientes por
   defecto. Hoy se reutilizan imágenes de entregables guardados; no se afirma
   captura automática del proyecto original.
5. Mediación del refresh live entre iframe y padre autenticado. El endpoint
   owner-only ya crea otra revisión, pero el puente y su aceptación faltan.
6. Precio comercial y presupuesto pagado aprobados; imágenes reales, reconciliación
   del coste y selección/corrección con el modelo real en app y página.
7. Build standalone general en el host de destino. En Windows se compiló y se
   generaron las 4869 páginas, pero la copia final tuvo errores EPERM. El bundle
   separado del worker sí se probó fuera del checkout.
8. Revisión final de rama; después UI, traducciones y ensayo desde el chat.

No se ejecutaron migraciones sobre la base real, llamadas pagadas, instalación
Docker, push ni deploy como parte de estas verificaciones locales.
