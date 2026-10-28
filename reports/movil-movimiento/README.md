# Len Móvil: pulido del movimiento

28 de octubre de 2026. Rama feat/len-movil-2 en su worktree propio.

## Cambios

- Gestión, Tu Len, Antes/Ahora y Equipo tienen entrada de 220ms y salida de 180ms con transform y opacidad. La pantalla saliente permanece inerte y oculta a lectores de pantalla hasta desmontarse.
- Reabrir cancela la salida; cambiar de proyecto descarta el contenido retenido.
- Reducir movimiento desactiva efectos y transiciones automáticas de la app, incluidos chat, halo y gestos al soltar. El personaje sigue los cambios de preferencia en vivo. El dedo conserva control directo del gesto.
- Temporizadores y listeners de gestos se limpian al desmontar.
- La salida no roba el foco a una pantalla nueva; Atrás omite capas retiradas y admite reemplazo rápido de paneles.
- El enfoque de un campo no desplaza el lienzo exterior: los scrolls permanecen dentro de cada panel/historial.
- No se modificó la interfaz web ni el motor compartido del personaje.

## Verificación

- 316 pruebas en 43 archivos: `npx vitest run movil/src app/api/movil lib/movil lib/notifications/fcm.test.ts lib/notifications/dispatch-fcm.test.ts --exclude '**/*.pg.test.ts' --maxWorkers 4 --minWorkers 1`.
- Tipos raíz (`npm run typecheck -- --incremental false`) y móvil; lint del alcance; build de producción Vite: correctos.
- `node reports/movil-movimiento-check.cjs`: Edge con toque en 390x844 y 360x640, movimiento normal/reducido y cambio de preferencia en vivo, cuatro paneles, salida inerte, sustitución Gestión->Tu Len, paso Equipo->chat, foco e historial.
- `node reports/movil-equipo-check.cjs`: menciones, respuestas/resolver, Back anidado, borradores y límites visibles del panel tras enfocar y mostrar error.
- `node reports/movil-sheet-check.cjs`: tacto, ratón, fade, cancelación, scroll de contenido largo y movimiento reducido.
- `node reports/movil-chat-cabecera-check.cjs`: fecha bajo cabecera, insets y teclado.
- Capturas 390 y 360 con movimiento normal/reducido en esta carpeta. Las capturas de Equipo y del panel principal se actualizaron con los flujos finales.

La revisión independiente reprodujo los fallos de navegación y foco durante salidas solapadas y confirmó sus arreglos. Las pruebas de regresión fallaron antes de corregir los comportamientos.

## Límites

La suite de integración `lib/movil/llaves.pg.test.ts` no se pudo ejecutar: conexión al Postgres local denegada por el entorno (EACCES). Los 316 tests anteriores excluyen esa integración; no se sustituyó por una base remota.

No se enviaron pedidos, mensajes o avisos reales: QA utiliza `clienteDeMuestra` de DEV y pruebas con servicios simulados. La APK no se ha generado ni instalado con estos cambios, y no se ha desplegado el servidor. Falta comprobar fluidez, teclado y llamadas en Android físico.
