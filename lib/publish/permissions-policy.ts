// La Permissions-Policy de las páginas: la publicada (Caddy, bloque
// *.openlen.app), los dominios propios (/served), el lienzo (sus dos rutas) y
// la copia del crate `edge`. Las tres de TypeScript importan esta; Caddy y Rust
// la copian, y `permissions-policy.test.ts` vigila que digan lo mismo.
//
// `self` y no `()`: la PROPIA página puede pedir cámara, micrófono y ubicación
// —escanear un código de barras, dictar, «cerca de mí»— y el navegador se lo
// pregunta al visitante, como en vercel.app o netlify.app. Cada página vive en
// su propio origen de .app, así que el permiso es de esa página y de ninguna
// otra. Un iframe ajeno dentro de la página (un vídeo, un mapa) sigue sin
// poder pedirlos.
export const PAGE_PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(self)";
