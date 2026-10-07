// ─────────────────────────────────────────────────────────────────────────────
// LAS IMÁGENES QUE ADJUNTA EL VISITANTE AL CREAR: cuántas.
//
// ⚰️ Aquí vivía también LA PUERTA de esas imágenes cuando viajaban como
// `data:` en el cuerpo de `/api/generate` —`leerReferenciaAdjunta`,
// `leerReferenciasAdjuntas`, los topes de 4 MB por foto y 12 MB por lote,
// `bytesDeBase64`—. Se fue con la ruta el 2026-10-06 (plans/crear-es-len,
// tarea 12): crear es el primer mensaje a Len, y sus fotos suben antes por
// `/api/upload`, que tiene sus propios límites.
// ─────────────────────────────────────────────────────────────────────────────

/** CUÁNTAS imágenes puede adjuntar el visitante a un brief.
 *
 *  El número NO sale del modelo. Los techos técnicos son enormes al lado de
 *  esto —Fireworks acepta muchas mas, y para comparar: la API de
 *  Claude admite 100 por petición y claude.ai 20 por mensaje—, así que 4 no es
 *  un límite técnico: es una decisión de producto y de factura.
 *
 *  Por qué 4 y no 1 (lo que había): una sola foto obliga a elegir entre el
 *  logo, el local y la referencia de estilo, y son tres cosas distintas que la
 *  página necesita a la vez. Cuatro cubre «mi logo + mi sitio + dos de
 *  inspiración» sin que nadie tenga que decidir.
 *
 *  Por qué 4 y no 20: cada imagen son ~1,5k tokens de visión que se pagan en
 *  CADA mensaje, y las fotos cruzan de la portada al taller por
 *  `sessionStorage`, cuya cuota ronda los 5 MB. A ~200 KB por foto reducida,
 *  cuatro caben con margen de sobra y veinte no.
 *
 *  Se comprueba en LOS DOS lados: la interfaz deja de aceptar (comodidad) y el
 *  servidor recorta (la puerta de verdad): `MAX_PHOTOS_PER_MESSAGE`
 *  (lib/projects/chat-photos.ts) es este mismo número, en `/api/agent`. */
export const MAX_REFERENCIAS = 4;
