// LAS HERRAMIENTAS QUE LEN RECIBE DE VERDAD, preguntadas al catálogo de la app
// (`buildFunctionDeclarations`) en vez de leídas de sus ficheros: con el
// entorno por defecto de producción, la terminal encendida (`bash` entra, Grep
// y Glob salen). Lo corre `check-content.mjs` con el tsx de la app, desde la
// raíz del repo (para el alias `@/`). Imprime UNA línea: el JSON de los nombres.
//
// `.mts` a propósito: el `include` de `sites/len/tsconfig.json` (`**/*.ts`) no
// lo recoge, y el typecheck de la web no tiene por qué compilar la app.
//
// 🔴 `functionSecrets: false` (15/10): la ruta de Len sólo declara
// `request_secrets` con las Edge Functions encendidas (`functionsEnabled()`,
// app/api/agent/route.ts), y en producción están APAGADAS. Sin esto el sitio
// público anunciaría una herramienta que hoy no recibe nadie. El día que se
// enciendan, se quita este argumento, el comprobador pedirá `request_secrets`
// en la tarjeta y el titular subirá en uno.
import { buildFunctionDeclarations } from "../../../lib/agent/catalog";

console.log(JSON.stringify(buildFunctionDeclarations({}, { functionSecrets: false }).map((d) => String(d.name))));
