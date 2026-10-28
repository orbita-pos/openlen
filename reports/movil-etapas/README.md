# Len Móvil: entrega de las cuatro etapas

**Estado actual:** backend de avisos y comparación desplegado en producción el
27 de octubre. Credencial FCM activa en el proceso y migración aplicada.
Pendiente la prueba de notificación en un Android registrado y actualizar la
APK del teléfono con el panel corregido (ver al final).

Implementación local del 26 de octubre de 2026. Sin commit, push, despliegue,
migración de una base existente ni envío real de notificaciones.

## Actualización: Firebase, 27 de octubre

- Proyecto `len-movil` creado por el usuario, Android `app.openlen.len`
  registrado y Cloud Messaging HTTP v1 habilitado, comprobado en la consola.
- `google-services.json` validado y copiado al módulo Android, ignorado por Git.
- Credencial de servicio RSA validada para ese proyecto y preparada únicamente
  en `.env.local`, ignorado por Git; no se imprime su contenido. El archivo
  descargado permanece fuera del repositorio.
- Google aceptó la autenticación OAuth para Firebase Messaging. El token de
  prueba no se imprimió ni se guardó y no se enviaron notificaciones.
- Nueva APK con Firebase compilada y firma v2 comprobada. Se verificaron los
  recursos Android de proyecto/app/sender y que el JavaScript no incluye la
  clave privada del servidor. SHA256:
  `af649731ee12b28595e84f83dd47948d1392364074540a8f8574ca95dbecb281`.
  Compilación: `apk-firebase-build.txt`; las 22 pruebas de avisos pasan:
  `firebase-pruebas.txt`.
- Preflight de producción, sólo lectura: servidor accesible, sin entrada FCM
  en su entorno y `/api/movil/avisos` todavía devuelve 404. No se ha subido la
  credencial, ejecutado la migración ni reiniciado producción.
- Compilación Next de producción completada. Paquete standalone compuesto,
  migraciones y procesos de avisos compilados; guardas de completitud,
  ausencia de secretos y arranque local pasaron (14.930 archivos, cero módulos
  de aplicación ausentes). También pasan infraestructura y la puerta de los
  diez idiomas. Registros: `servidor-firebase-build.txt`,
  `firebase-bundle-check.txt`, `firebase-migraciones-build.txt`,
  `firebase-cron-build.txt`, `infra-firebase-check.txt`,
  `i18n-firebase-check.txt`.
- La APK nueva aún necesita el despliegue del servidor para activar los avisos.
  El historial de verificación siguiente corresponde a la entrega anterior.

### Activación en producción autorizada

El usuario autorizó el despliegue después de aclarar que FCM no tiene costo y
que se conserva Spark. Credencial instalada por stdin cifrado de SSH en
`/etc/openlen/openlen.env`, sin imprimirla ni crear una copia JSON del secreto
en el servidor. Resto de variables conservado; permisos verificados:
`640 root:openlen-deploy`. Las cuatro pruebas del instalador verifican
conservación, JSON válido, idempotencia y fallos atómicos.

El proxy activo difiere del repositorio y contiene ajustes de producción;
se añadió y verificó el parámetro `-PreserveCaddy` para conservarlo en este
release de la app. Los 42 tests de contratos de despliegue pasan. El pipeline
usa el build ya verificado y conserva las puertas de validación, migraciones
y recompilación nativa. Registro: `despliegue-fcm.txt`.

La subida del paquete terminó y las migraciones se aplicaron correctamente.
Antes del reinicio se comprobó con la identidad de base de datos de la app:
tabla `movilAvisos` accesible para lectura/alta/rotación/baja y FK compuesta
llave/usuario presente. Hay cero dispositivos suscritos. La compilación de los
componentes nativos del servidor continúa antes de intercambiar versiones.

### Resultado final del despliegue

- Pipeline terminado con éxito, incluidos los tres componentes nativos Linux.
  El empaquetado local fue la parte lenta: archivo de 1.011,6 MB, 2.214,3 s;
  subida en 80,9 s y compilación nativa en 313,8 s.
- Versión activa coincide con el build local:
  `bnLEa5qNPk7ccuETcnNUl`. Servicio `openlen-app` activo.
- Proceso reiniciado: credencial RSA de Firebase `len-movil` cargada y válida.
- Tabla de avisos, permisos de la app y FK de llave/usuario verificados.
  Cero dispositivos registrados; no se ha enviado un push de prueba real.
- Portada `/es`: HTTP 200. APIs `/api/movil/avisos` y
  `/api/movil/entrega`: HTTP 401 sin credenciales, como corresponde.
  Preflight de Android: HTTP 204 y origen `https://localhost` permitido.
  `/api/health` devuelve 404 porque este build no declara esa ruta; se verificó
  disponibilidad con la portada, las APIs reales y el servicio de sistema.
- Temporizador de avisos activo, último resultado `success` y código 0.
- Proxy conservado byte por byte: SHA256
  `748251601bc73b4c2fe6124d4744aafc8d1f8b02f8642953fac67fe1d0f210ee`.
- Se mantuvo el plan Firebase existente y no se contrataron servicios nuevos.
- ADB no detectó ningún Android conectado y autorizado. Falta instalar la APK,
  iniciar sesión, activar avisos y probar recepción/apertura en un teléfono.

| Etapa | Antes | Ahora |
| --- | --- | --- |
| Entrega | Resumen de Len y vista previa | Progreso con acciones/tareas reales y fallos visibles, entrega visual de 1,5 s saltable, comparación estática de versiones distintas del mismo documento |
| Publicar y gestionar | Algunas tarjetas dentro de la conversación | Pantalla para publicar/actualizar con confirmaciones, compartir la URL publicada, consultar visitas y crear/reanudar/pausar/quitar encargos |
| Avisos | Sin registro push Android | Suscripción por llave/usuario, canal FCM en la cola existente, permisos y apertura segura del proyecto; desactivado explícitamente mientras falta Firebase |
| Tu Len | Personaje fijo | Estilos y accesorios combinables con vista previa, aplicar/cancelar y persistencia local que actualiza todas las caras |

## Evidencia

296 pruebas del alcance pasan en 42 archivos; incluye API, permisos de acceso,
aislamiento de proyectos, reintento de encargos, progreso sin datos viejos,
comparación, Postgres en memoria, avisos, personalización y los diez idiomas.
Ver `pruebas.txt`. El cierre sin Firebase volvió a pasar sus 10 pruebas después
del último ajuste. TypeScript de raíz y móvil pasan. Lint sin avisos ni errores
en el alcance (`lint.txt`).

QA con Edge y datos de muestra explícitos, sin cuenta ni consumo de IA:
390×844 y 360×640; comparación Antes/Ahora, gestión, números, encargos,
personalización persistida, avisos sin configurar, modo oscuro y acceso a
Salir en pantalla compacta. Diez capturas, sin errores JavaScript.
Reproducible con `node reports/movil-etapas-qa.cjs` y Vite en el puerto 5175.

- [Principal](01-principal.png)
- [Ahora](02-comparacion-ahora.png) · [Antes](03-comparacion-antes.png)
- [Publicar](04-publicar.png) · [Tus números](05-numeros.png) · [Encargos](06-encargos.png)
- [Tu Len](07-tu-len.png) · [Avisos](08-avisos.png)
- [Modo oscuro](09-oscuro.png) · [Pantalla compacta](10-pantalla-compacta.png)

La suite general del repositorio se intentó además del alcance. Reportó fallos
fuera de los archivos de esta entrega: arranque de Chromium bloqueado por el
sandbox (`3221225506`), reemplazos de archivos temporales con `EPERM` y
validaciones de red. Se interrumpió después de comprobar estos bloqueos; no
terminó ni se presenta como verde.

## APK

`movil/android/app/build/outputs/apk/debug/app-debug.apk`, compilada con éxito
con los plugins nativos de compartir y avisos. Firma de depuración verificada
con APK Signature Scheme v2. Paquete `app.openlen.len`, Android mínimo 24,
target 36. Se comprobó dentro del APK que no contiene servidor de desarrollo
ni los datos de muestra. Registro de compilación: `apk-build.txt`.

SHA256: `eb2b7b1aeeb1b1df55570f083e0f6f07abb363406f81840f82417a93cf1b9c8e`.

## Lo que requiere el entorno real

1. Desplegar los cambios del servidor para que exista `/api/movil/entrega`.
   Hasta entonces, la APK contra producción no puede cargar la comparación.
2. Crear/configurar Firebase para activar avisos, aportar el archivo Android
   y las credenciales exclusivamente del servidor, y ejecutar la migración
   aditiva de suscripciones en el entorno elegido. Procedimiento completo en
   [avisos](../../movil/src/avisos/README.md).
3. Instalar y probar en un teléfono: login, llamada/micrófono, teclado/foto,
   compartir, publicar con cuenta real, encargos, atrás, suspensión y red.
   Para push: permiso denegado/concedido, primer plano, segundo plano,
   arranque cerrado, rotación del token, logout y cambio de cuenta.

ADB se consultó y no había dispositivos conectados. Las capturas del navegador
y la firma del paquete no sustituyen la prueba física. La publicación en
tiendas, firma de distribución e iOS siguen fuera de esta entrega.
## Correcciones de la prueba física — actualización autorizada (27/10)

El usuario autorizó «ok subelo entonces» tras aclarar que sólo se aplicaría
el ajuste puntual del proxy y una APK nueva, sin despliegue general.

- Vista previa Android: reproducido `ERR_BLOCKED_BY_RESPONSE` por
  `X-Frame-Options: SAMEORIGIN`. Política limitada a `/p/*` preparada en
  `infra/caddy/Caddyfile`; mantiene el sandbox y permite sólo los orígenes de
  Len. 39 pruebas de infraestructura pasan y Caddy adapta correctamente.
  **Aplicada** en producción a las 01:35 UTC del 28/10 (27/10 local). Caddy
  validado y recargado; backup:
  `/etc/caddy/Caddyfile.before-len-preview-20261028013500`. El diff del archivo
  activo añade sólo siete líneas de política para `/p/*`. Prueba real en Edge:
  `https://localhost` muestra el documento; `https://untrusted.example` queda
  bloqueado explícitamente por CSP; `/es` responde 200 y mantiene SAMEORIGIN.
  Script con backup y rollback: `corregir-preview-caddy.py`. El build general
  sigue en `bnLEa5qNPk7ccuETcnNUl`; openlen-app conserva su inicio de las
  18:51:23 UTC del 27/10, sin reiniciarse en esta actualización.
- Panel inferior: corregido localmente el arrastre desde contenido y márgenes;
  el cuerpo conserva su tamaño, acompaña al dedo y se desvanece continuamente.
  Los botones plegados quedan inertes. Prueba táctil en Edge a 390×844 y
  360×640: arrastrar sobre un botón sin activarlo, abrir desde el borde,
  cancelar, toque posterior, scroll nativo con texto largo y movimiento
  reducido. Reproducible con `node reports/movil-sheet-check.cjs` y Vite en
  5175. Capturas `sheet-*-arrastrando.png`, `sheet-*-cerrado.png` y
  `sheet-*-abierto.png`. Ratón verificado sin llamadas accidentales. TypeScript
  de raíz y móvil, build web de producción, lint del alcance y 7 pruebas de
  principal/chat pasan. APK recompilada con éxito (276 tareas), firma v2 válida,
  paquete `app.openlen.len`; se verificó dentro del paquete el panel nuevo y
  la ausencia de servidor de desarrollo, muestra y clave privada.
  SHA256 `0eedea3be05a64877c0418e16d43dbc3b4d88d146d5cfc98b15081f8269efe6d`.
  Copia de entrega: `movil/android/app/build/outputs/apk/debug/Len-movil-actualizado.apk`.
  **Pendiente que el usuario confirme Actualizar en el teléfono.** Tras volver
  a conectar el Samsung A07 se copió `Len-movil-actualizado.apk` a
  `Internal storage/Download` por MTP. Verificado en el Explorador: archivo
  presente de 8.21 MB; la carpeta pasó de 21 a 22 elementos. Las huellas de
  origen y copia local de entrega coinciden antes de la transferencia.

## Nueva revisión del teléfono: barras y fecha del chat (27/10, 20:00)

Cambios locales de la app; no requieren tocar el servidor:

- Barras superior e inferior: pasan a seguir el tema elegido en Len con
  `SystemBars` de Capacitor 8. El arranque usa `LIGHT` (iconos oscuros) y el
  tema oscuro usa `DARK` (iconos claros). Se retiró el plugin StatusBar
  anterior, que inicializaba y restauraba otro estilo según el tema del
  teléfono. MainActivity activa edge-to-edge para mantener el mismo layout
  en las versiones Android compatibles.
- Fecha: cabecera e historial se disponen en flujo flex, con un viewport de
  scroll separado debajo del encabezado. Su altura se adapta al estado de
  Len, los márgenes nativos y el teclado sin medir con ResizeObserver ni
  introducir bucles de redimensionado. Se respetan las variables de área
  segura que inyecta Capacitor. Conserva el caso de llamada flotante.
- Antes del arreglo fallaron las dos pruebas del contraste nativo y la
  regresión visual de la fecha con estado de trabajo. Después pasan las
  17 pruebas de tema/principal/chat/lienzo y la prueba visual a 390×844 y
  360×640, con estado de Len, insets Android y ventana reducida por teclado;
  la prueba final exige cero errores JavaScript.
  Capturas `chat-*-fecha-visible.png` y `chat-*-teclado-fecha.png`.
- El contraste de los iconos reales aún requiere confirmar la actualización
  en el Samsung. Las capturas web no incluyen las barras del sistema Android.
- APK final compilada y firmada: `Len-movil-barras-chat.apk` en
  `movil/android/app/build/outputs/apk/debug/`. Empaquetado final: 169 tareas,
  3 ejecutadas, 166 reutilizadas; firma v2 válida. Se compararon byte por byte
  los recursos empaquetados con el último `dist`, se confirmó SystemBars
  LIGHT y la ausencia del plugin anterior, servidor dev, muestra y clave
  privada. SHA256:
  `c63170577edf109bf35ee8979acef20a7a4a5d4b7802e80d8e6429afe307ee3d`.
  Registro: `apk-barras-chat-final.txt`. No se tocó el servidor. La laptop
  ya no detectaba el Samsung; esta APK todavía no se copió ni instaló allí.

