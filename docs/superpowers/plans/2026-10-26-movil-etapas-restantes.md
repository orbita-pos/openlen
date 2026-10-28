# Len Móvil: entrega, gestión, avisos y Tu Len

> Ejecución con superpowers:subagent-driven-development y dispatching-parallel-agents. El usuario autorizó las cuatro etapas expresamente. Referencia visual: brand/len-movil/index.html; decisiones originales: plans/app-movil/README.md y spec de pieza 1.

**Objetivo:** completar las cuatro superficies funcionales en Android sin editor de código ni simulaciones presentadas como datos reales.
**Arquitectura:** conservar Vite/React/Capacitor y API con llave de dispositivo; aprovechar publicación, visitas, encargos, versiones y cola de avisos ya existentes. Pantallas aisladas integradas por principal.tsx. Prototipo naranja/oscuro y motor de cara existentes.

## Contratos y reparto

- Principal, chat/use-chat, api/proyectos, entrega y comparación: coordinador.
- Gestión: agente gestion, `movil/src/gestion/gestion.tsx`, CSS propio, API propia y pruebas. Exportar `Gestion` con props `{cliente, projectId, idioma, trabajando, turnoId: string|null, onCerrar, onCambio, onEncargo(texto, modo: 'create'|'resume')}`. Consultar estado real del proyecto, publicar con errores de revisión conservados, compartir únicamente URL publicada, visitas y encargos crear/reanudar/pausar/quitar. No escribir principal ni use-chat.
- Avisos: agente avisos, canal FCM y registro autenticado de dispositivo, migración, integración en cola existente; hook móvil `useAvisos({cliente,onAbrirProyecto})` y control `ControlAvisos`. Sin secretos inventados ni envíos reales. Configuración Firebase se inspecciona por presencia y se documenta si falta.
- Tu Len: agente personalizacion, pantalla `TuLen({onCerrar})`, preferencia persistente y actualización de todas las caras. Puede modificar cara.tsx y su declaración compartida; conservar API anterior y motor. No editar principal.
- Traducciones: cada parte exporta mapa de los 10 idiomas en `movil/src/textos-gestion.ts`, `textos-avisos.ts`, `textos-personalizacion.ts`; coordinador los combina bajo los nombres correspondientes dentro de `movil` en Textos. No editar JSON compartidos simultáneamente.
- Dependencias: sólo coordinador modifica package.json/lock y sincroniza Capacitor. Agentes comunican necesidades. Rama/checkout actuales, conservar trabajo previo; sin commit, push ni deploy.

## Pasos verificables

- [x] Gestión: pruebas de flujos, errores de publicar, URL compartida, acceso/encargos y UI.
- [x] Avisos: tests de alta/baja/propiedad, datos de notificación, token inválido, configuración ausente, navegación por proyecto; migración y documentación.
- [x] Tu Len: tests de persistencia, cancelar/aplicar, opciones válidas y motor; interfaz del prototipo.
- [x] Entrega: pruebas de progreso, fallo visible, comparación de versiones reales aisladas, reenganche y cambio de proyecto; animación breve saltable/reduced-motion.
- [x] Integración: navegación/atrás, datos demo explícitos para QA, traducciones completas; controles accesibles y sin acciones muertas.
- [x] Verificación: suite acotada, TypeScript, lint, build web, QA visual, APK; revisión de cambios y reporte honesto de configuración/dispositivo pendientes.

## Reglas de implementación

Una respuesta antigua nunca contamina el proyecto nuevo. Nunca presentar dos copias del documento actual como Antes/Ahora. No ejecutar HTML de usuario en el origen de la app. No generar progreso porcentual ficticio. Publicar/compartir/permitir avisos sólo por acción del usuario. No desplegar ni activar servicios externos como parte de esta implementación local.

## Registro

- Estado inicial: primera etapa aplicada sin commits, 179 pruebas pasaban, APK de depuración compilado. Se conserva íntegra.
- Implementadas las cuatro superficies e integradas en principal. «Tu Len» aplica accesorios a todas las caras; cancelación conserva el estilo previo. Gestión usa APIs existentes y conserva las puertas de confirmación. Nuevas APIs móviles para comparación y suscripciones FCM.
- Revisión independiente: corregidos el reintento de encargos que perdía `goal` y el progreso que podía heredar acciones del turno anterior. Regresiones cubiertas. También se aisló la llegada de eventos tardíos al cambiar de proyecto.
- Suscripciones FCM: relación compuesta entre llave y usuario en esquema/migración, probada con Postgres en memoria. Ninguna conexión de pruebas a una base existente ni envío real de avisos.
- 296 pruebas del alcance pasan (42 archivos), TypeScript móvil y raíz pasaron en la integración, lint del alcance sin avisos. QA local con Edge a 390×844: 9 capturas, pantallas de gestión/comparación/Tu Len/avisos/oscuro, persistencia y ausencia de errores JavaScript. Evidencia en `reports/movil-etapas/`.
- Firebase pendiente: el usuario confirmó que aún no tiene proyecto. La app indica que los avisos no están configurados y no llama al registro nativo. Pasos de activación en `movil/src/avisos/README.md`.
- APK final compilada y firma v2 verificada. SHA256 `eb2b7b1aeeb1b1df55570f083e0f6f07abb363406f81840f82417a93cf1b9c8e`. Sin servidor dev ni datos de muestra en el paquete. QA ampliado a 360×640, 10 capturas y scroll/Salir accesibles.
- Suite general intentada e interrumpida al confirmar fallos fuera del alcance por arranque de Chromium bloqueado, operaciones temporales `EPERM` y red; no se declara terminada ni verde. Evidencia del alcance y limitaciones documentadas en `reports/movil-etapas/README.md`.
- ADB no encontró ningún teléfono conectado. La prueba en dispositivo físico, la configuración Firebase y el despliegue/migración del servidor siguen pendientes; no se presentan como verificados.
- 27 de octubre: el usuario creó Firebase `len-movil` y registró Android. Archivo público instalado en el módulo Android; credencial de servicio validada localmente y aceptada por Google OAuth. Credencial sólo en `.env.local` ignorado. APK nueva con Firebase compilada, firma v2 verificada y sin la clave privada del servidor. SHA256 `af649731ee12b28595e84f83dd47948d1392364074540a8f8574ca95dbecb281`.
- Preparación de servidor del 27: build Next y composición standalone completos, cron/migraciones compilados, controles de infraestructura/idiomas y arranque del paquete pasan. Producción inspeccionada sólo en lectura: falta FCM y `/api/movil/avisos` devuelve 404. Queda solicitar autorización concreta antes de subir la credencial, migrar y reiniciar producción.
- El usuario autorizó explícitamente activar producción tras aclarar el costo de FCM. Se instaló la credencial por stdin de SSH en el entorno privado (modo 640), preservando variables. Despliegue en curso con `-PreserveCaddy` para conservar ajustes activos del proxy que difieren del repo; 42 pruebas de contratos y 4 del instalador pasan. Registro en `reports/movil-etapas/despliegue-fcm.txt`. No se cambia plan Firebase ni se contratan servicios nuevos.
- Despliegue del 27 completado. Build activo/local `bnLEa5qNPk7ccuETcnNUl`, proceso con FCM RSA válido, migraciones/privilegios/FK correctos, cero dispositivos. `/es` 200; APIs de avisos y comparación 401 sin autenticación; OPTIONS Android 204 con CORS correcto. Temporizador activo y última ejecución success/0. Proxy conservado (SHA256 `748251601bc73b4c2fe6124d4744aafc8d1f8b02f8642953fac67fe1d0f210ee`). ADB sin Android autorizado; push en teléfono y apertura desde aviso siguen pendientes de prueba física. No se declara un envío real realizado.
