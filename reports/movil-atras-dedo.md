# Volver con el dedo — Len Móvil

Fecha: 28 de octubre de 2026. Rama `feat/len-movil-2`.

## Comportamiento

Deslizar hacia la derecha mueve la pantalla con el dedo en Publicar y gestionar, Tu Len, Antes/Ahora, Equipo y chat. Al superar el umbral, termina de salir en 160 ms; si el gesto se cancela o queda corto, regresa en 180 ms. Los paneles no añaden otra animación al terminar el gesto. Los botones de cierre y Atrás siguen disponibles.

En un hilo, el primer gesto vuelve a la lista; el siguiente cierra Equipo. Se conservan la instancia del panel y el historial por niveles. Cambiar de paso/proyecto o cerrar el chat cancela callbacks antiguos. Repetir un gesto durante el regreso no deja que una limpieza anterior corte la salida nueva.

Se excluyen campos editables, selectores, iframes, zonas marcadas sin arrastre y contenedores con scroll horizontal. Los carruseles y adjuntos conservan sus gestos nativos, así como el scroll vertical. El overscroll horizontal del documento móvil no navega el historial al seleccionar texto. Movimiento reducido omite la animación al soltar.

## Verificación

- Edge con eventos táctiles CDP: 390×844 y 360×640, movimiento normal/reducido. Cuatro paneles, progreso visible, cancelación, gesto corto, cierre, carrusel en ambas direcciones, scroll vertical con contenido largo simulado, campo de Equipo y chat con altura de teclado de 400 px. Hilo → lista → proyecto, identidad del panel conservada y nivel final del historial 0. Cero errores JavaScript.
- Prueba existente de hoja: subir/bajar desde botón y borde, cancelación, scroll largo, contenido estable, movimiento reducido y ratón. Dos tamaños aprobados.
- Suite de móvil/API/notificaciones: 45 archivos y 342 pruebas aprobadas, excluyendo integración PostgreSQL. Tras los últimos casos de cancelación de chat/contexto, 14 pruebas específicas aprobadas.
- Compilación Vite de producción, tipos de raíz y móvil, y lint de los archivos cambiados aprobados. Lint con cero errores y advertencias de código; sólo el aviso del ejecutable sobre el formato antiguo de configuración ESLint.
- Revisión independiente: sin problemas pendientes. Se corrigió el temporizador de regreso señalado por el revisor, moviendo su cancelación al inicio confirmado del siguiente arrastre.

Prueba reproducible: `node reports/movil-atras-dedo-check.cjs`, con Vite local en 5175 y datos de `?muestra=1`. Bloquea solicitudes externas. No envía mensajes, notificaciones, cargas ni llamadas a modelos reales.

## Alcance

Sólo interfaz móvil y documentación de verificación. No cambia web/servidor, dependencias ni master. Sin despliegue ni instalación de APK. La prueba de sensación/fluidez y del gesto del sistema Android en el Samsung físico queda pendiente.
