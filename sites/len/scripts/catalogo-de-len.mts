// LAS HERRAMIENTAS QUE LEN RECIBE DE VERDAD, preguntadas al catálogo de la app
// (`buildFunctionDeclarations`) en vez de leídas de sus ficheros: con el
// entorno por defecto de producción, la terminal encendida (`bash` entra, Grep
// y Glob salen). Lo corre `check-content.mjs` con el tsx de la app, desde la
// raíz del repo (para el alias `@/`). Imprime UNA línea: el JSON de los nombres.
//
// `.mts` a propósito: el `include` de `sites/len/tsconfig.json` (`**/*.ts`) no
// lo recoge, y el typecheck de la web no tiene por qué compilar la app.
import { buildFunctionDeclarations } from "../../../lib/agent/catalog";

console.log(JSON.stringify(buildFunctionDeclarations({}).map((d) => String(d.name))));
