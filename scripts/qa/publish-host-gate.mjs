import { execFileSync } from "node:child_process";
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

// ─────────────────────────────────────────────────────────────────────────
// Y QUE LA INTERFAZ LA USE.
//
// Que la variable exista no sirve de nada si quien pinta el subdominio lo
// escribe a mano. El 2026-09-09 Jesús vio la lista de proyectos diciendo
// `.openlen.com` con las páginas naciendo en `.app` desde hacía 17 días:
// `projects-view.tsx` lo tenía cinco veces —una de ellas en el `href`, o sea
// que el enlace llevaba al dominio viejo— y `analytics-view.tsx` una más.
// Esta comprobación no existía y por eso pasó: la de arriba mira el ENTORNO,
// ésta mira el CÓDIGO.
//
// Sólo se persigue `<algo>.<host>` pegado a un subdominio. El apex suelto
// (`openlen.com` como nombre del sitio, que es lo que dicen las políticas)
// es correcto y no cuenta.

const HOSTS = ["openlen.com", "openlen.app"];
const patron = HOSTS.map((h) => "\\}\\." + h.replace(/\./g, "\\.")).join("|");

let golpes = "";
try {
  golpes = execFileSync(
    "git",
    ["grep", "-n", "-I", "-E", patron, "--", "app/**/*.tsx", "app/**/*.ts", "components/**/*.tsx", "lib/**/*.ts"],
    { encoding: "utf8" },
  );
} catch (e) {
  // git grep sale con 1 cuando no encuentra nada: es el caso bueno.
  if (e.status !== 1) throw e;
}

const lineas = golpes
  .split("\n")
  .filter((l) => l.trim())
  .filter((l) => !/\.test\.tsx?:|\/evals\/|mock-data/.test(l));

if (lineas.length > 0) {
  console.error("");
  console.error(`  EL DOMINIO DE PUBLICACION ESTA ESCRITO A MANO en ${lineas.length} sitio(s):`);
  console.error("");
  for (const l of lineas) console.error("    " + l.trim().slice(0, 150));
  console.error("");
  console.error("  Eso pinta el dominio viejo aunque las paginas nazcan en otro.");
  console.error("  No falla: MIENTE. Usa lib/publish/base-host.ts:");
  console.error("");
  console.error("    publishedHost(sub)   -> mitienda.openlen.app");
  console.error("    publishedUrl(sub)    -> https://mitienda.openlen.app");
  console.error("    PUBLISHED_BASE_HOST  -> openlen.app   (para prosa)");
  console.error("");
  process.exit(1);
}

console.log(`  publish host (interfaz): ${valor}  ·  0 literales a mano`);
