// El dominio que se PINTA tiene que viajar con el bundle.
//
// `PUBLISH_BASE_HOST` vive en el box y manda: decide dónde nace una página.
// Pero un componente de cliente no puede leerlo — sólo ve las variables
// `NEXT_PUBLIC_*`, y esas se hornean cuando `next build` corre AQUÍ, en el
// portátil. Si falta, el bundle sale con el valor por defecto y la interfaz
// entera dice `openlen.com` mientras las páginas nacen en otro sitio.
//
// Eso pasó de verdad: PUBLISH_BASE_HOST=openlen.app llevaba un día en
// producción y la interfaz seguía diciendo openlen.com — el menú Publicar, el
// sufijo del diálogo, la barra de estado. Nada fallaba. Sólo mentía.
//
// Esta comprobación cuesta milisegundos y convierte ese día en un mensaje.

const valor = process.env.NEXT_PUBLIC_PUBLISH_BASE_HOST?.trim();

if (!valor) {
  console.error("");
  console.error("  FALTA NEXT_PUBLIC_PUBLISH_BASE_HOST en .env.local");
  console.error("");
  console.error("  Es la copia que viaja al navegador del PUBLISH_BASE_HOST del box.");
  console.error("  Sin ella la interfaz pinta openlen.com aunque las paginas nazcan");
  console.error("  en otro dominio: no falla, miente.");
  console.error("");
  console.error("  Anade a .env.local la linea que corresponda al box:");
  console.error("");
  console.error("    NEXT_PUBLIC_PUBLISH_BASE_HOST=openlen.app");
  console.error("");
  console.error("  Comprueba lo que dice el box con:");
  console.error("    ssh openlen \"grep PUBLISH_BASE_HOST /etc/openlen/openlen.env\"");
  console.error("");
  process.exit(1);
}

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(valor)) {
  console.error(`  NEXT_PUBLIC_PUBLISH_BASE_HOST no parece un dominio: "${valor}"`);
  process.exit(1);
}

console.log(`  publish host (interfaz): ${valor}`);
