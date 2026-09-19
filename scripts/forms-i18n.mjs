// LA TABLA DE IDIOMAS DEL FORMULARIO PUBLICADO, generada desde los catálogos.
//
// El guion que se hornea en cada página publicada (`crates/html-engine/src/
// publish/forms.rs`) le contesta al visitante en su idioma: «gracias» al enviar
// y el aviso si el servidor falla. Esas veinte frases YA existían traducidas en
// `messages/<loc>/…`, así que aquí no se inventa ninguna: se copian.
//
// Existe porque el binario de Rust no lee los JSON del repo, así que la tabla
// vive duplicada dentro del guion. Una copia sin guarda se pudre
// (`forms-i18n.test.ts` es la guarda; este fichero es el generador).
//
//   node scripts/forms-i18n.mjs --check   → 0 si forms.rs está al día, 1 si no
//   node scripts/forms-i18n.mjs --write   → reescribe la tabla dentro de forms.rs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Los diez de `app/[locale]`. El orden fija el de la tabla, para que el diff
 *  de una traducción cambiada sea una línea y no todo el bloque. */
export const LOCALES = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"];

export const RUTA_FORMS = join("crates", "html-engine", "src", "publish", "forms.rs");

/** Busca la clave a cualquier profundidad: el catálogo la anida y mover la
 *  frase de sección no debería romper esto. */
function buscar(objeto, clave) {
  if (!objeto || typeof objeto !== "object") return undefined;
  if (Object.hasOwn(objeto, clave) && typeof objeto[clave] === "string") return objeto[clave];
  for (const valor of Object.values(objeto)) {
    const hallado = buscar(valor, clave);
    if (hallado !== undefined) return hallado;
  }
  return undefined;
}

function leer(locale, fichero) {
  return JSON.parse(readFileSync(join("messages", locale, fichero), "utf8"));
}

/** `var T={…};` en ASCII puro — el fichero .rs se queda sin bytes altos y el
 *  guion viaja igual por cualquier tubería que no declare codificación. */
export function tablaDeIdiomas() {
  const tabla = {};
  for (const loc of LOCALES) {
    const ok = buscar(leer(loc, "panelsProps.json"), "successMessagePlaceholder");
    const err = leer(loc, "panelsChat.json")?.errors?.generic;
    if (!ok) throw new Error(`falta successMessagePlaceholder en messages/${loc}/panelsProps.json`);
    if (!err) throw new Error(`falta errors.generic en messages/${loc}/panelsChat.json`);
    tabla[loc] = { ok, err };
  }
  // JSON.stringify no escapa los no-ASCII; se escapan a mano.
  const crudo = JSON.stringify(tabla);
  const ascii = crudo.replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return `var T=${ascii};`;
}

/** La línea que hay HOY dentro de forms.rs, o null si no está. */
export function tablaEnForms(raiz = process.cwd()) {
  const fuente = readFileSync(join(raiz, RUTA_FORMS), "utf8");
  return fuente.match(/^ {2}var T=\{.*\};$/m)?.[0].trim() ?? null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  const esperada = tablaDeIdiomas();
  const actual = tablaEnForms();
  if (process.argv.includes("--write")) {
    const ruta = RUTA_FORMS;
    const fuente = readFileSync(ruta, "utf8");
    if (!actual) throw new Error("no encontré la tabla dentro de forms.rs");
    writeFileSync(ruta, fuente.replace(actual, esperada), "utf8");
    console.log(actual === esperada ? "sin cambios" : "tabla actualizada en forms.rs");
  } else {
    if (actual === esperada) {
      console.log(`forms.rs al día — ${LOCALES.length} idiomas`);
    } else {
      console.error("forms.rs NO está al día. Corre: node scripts/forms-i18n.mjs --write");
      process.exitCode = 1;
    }
  }
}
