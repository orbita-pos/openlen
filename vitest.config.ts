import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the Editor V5 overlay-editor core (jsdom). Playwright owns the
// browser-level e2e/visual suite (tests/e2e/**, run via `npm run test:e2e`).
//
// SCOPE: `include` is intentionally limited to the workspace editor tests. The
// repo also ships 9 pre-existing lib/**/*.test.ts files that were committed
// before any runner existed; they import the native @/lib/html-engine Rust
// binding, which vite can't load (.node) — wiring those (a crate mock or a
// node-env + built binary) is a separate task, not part of Editor V5. The `@`
// alias below is set so they CAN be run explicitly later (`vitest run lib/...`).
export default defineConfig({
  // jsx: "automatic" — the repo's tsconfig.json has "jsx": "preserve" (Next's
  // SWC owns the real transform at build time), so esbuild has no signal to
  // use the react-jsx runtime by default and falls back to classic
  // React.createElement, which needs `React` in scope. None of the app's own
  // .tsx files import a default `React` (they rely on Next's automatic
  // runtime) — this makes vitest's esbuild transform match that, first
  // needed here by scan-overlay.test.tsx.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // A server-only module imports
      // "server-only" as a marker. Next resolves it to empty.js in production
      // via the `react-server` exports condition; vitest doesn't set that
      // condition, so it falls through to index.js, which throws "This module
      // cannot be imported from a Client Component module". Point the bare
      // specifier straight at the same empty.js Next would pick — this is an
      // alias for ONE package, not `resolve.conditions: ["react-server"]`,
      // which would repoint conditional exports for the entire dependency
      // tree (React itself included) and is a much bigger blast radius.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    environment: "jsdom",
    include: [
      // Barre app/ y components/ enteros, así que vive en la raíz de components
      // y hay que nombrarlo aquí: `include` es LISTA BLANCA y un .test.ts que
      // no esté listado NO CORRE NUNCA.
      "components/claves-de-traduccion.test.ts",
      "components/workspace-v2/**/*.test.ts",
      "components/workspace-v2/**/*.test.tsx",
      "tools/template-visual-metadata-reviewer/**/*.test.ts",
      "tools/template-visual-metadata-reviewer/**/*.test.tsx",
      "tools/visual-engine-2a-reviewer/**/*.test.ts",
      "tools/visual-engine-2a-reviewer/**/*.test.tsx",
      "components/community/**/*.test.ts",
      "lib/workspace-v2/**/*.test.ts",
      "lib/sections/**/*.test.ts",
      "lib/analytics/**/*.test.ts",
      // Len sabe de tus resultados (plans/len-resultados/).
      "lib/resultados/zona.test.ts",
      "lib/resultados/contacto.test.ts",
      "lib/resultados/enlaces-de-respuesta.test.ts",
      // 🔴 CONTRA POSTGRES, sólo base local (`exigirBaseLocal`), como
      // `escribir-data.pg.test.ts`. Sin su línea no corren ni a mano: vitest
      // contesta «No test files found» — lista BLANCA.
      "lib/resultados/zona-guardada.pg.test.ts",
      "lib/resultados/visto.pg.test.ts",
      "lib/resultados/visitas.pg.test.ts",
      "lib/resultados/formularios.pg.test.ts",
      "lib/resultados/mensajes.pg.test.ts",
      // Hablar con Len por voz (docs/superpowers/specs/2026-09-30-len-voz-design.md).
      "lib/voz/**/*.test.ts",
      "components/llamada/**/*.test.ts",
      "components/llamada/**/*.test.tsx",
      "app/api/voz/**/*.test.ts",
      // La app de Len (docs/superpowers/specs/2026-10-01-len-movil-pieza-1-design.md).
      "lib/movil/**/*.test.ts",
      "lib/login/**/*.test.ts",
      "app/api/movil/**/*.test.ts",
      "movil/src/**/*.test.ts",
      "movil/src/**/*.test.tsx",
      // Len-Bench (plans/len-2/diseno.md). Las piezas puras de la vara; lo
      // que abre Chromium o habla con el servidor se prueba con
      // `bench:len:validar`, que es su prueba en rojo y en verde.
      "lib/len-bench/**/*.test.ts",
      // La terminal de Len (plans/len-agente-2026, F1).
      "lib/agent/terminal/**/*.test.ts",
      // Buscar y leer en internet (plans/len-agente-2026, F2).
      "lib/agent/web/**/*.test.ts",
      // Lo que cambió en el turno, fichero a fichero (la lente «Cambios»).
      "lib/agent/cambios-del-turno.test.ts",
      // `include` es una LISTA BLANCA: un .test.ts fuera de ella NO corre, y
      // pasa desapercibido porque `npm test` sale verde igual.
      // El backend de las páginas: la API de Supabase sobre nuestro Postgres
      // (plans/pages-backend/design.md). Lista blanca: sin esta línea no corre.
      "lib/backend/**/*.test.ts",
      // Lo que las TRES superficies mandan de verdad: nada de gusto nuestro,
      // ningún módulo ni conducta retirados, y el JavaScript del modelo sí
      // ofrecido. Importa app/api/**/system-prompt.ts (módulos planos, sin
      // nativo/DB/auth) + lib/agent/catalog.ts (ya vitest-safe, ver la NB de
      // abajo). Vive en la raíz de lib/, así que necesita su propia entrada.
      // Se llamaba design-guidance-seam.test.ts y vigilaba un fichero que ya
      // no existe; renombrado el 2026-08-28.
      "lib/prompts-superficies.test.ts",
      // EL GOLDEN de las cuatro superficies: la salida ENTERA, no la presencia
      // de unas cláusulas. Hasta el 2026-09-01 no habia ni un snapshot en todo
      // el repo, asi que ~32.000 caracteres de cada prompt podian derivar en
      // silencio. `include` es LISTA BLANCA: sin esta linea no correria.
      "lib/prompts-golden.test.ts",
      // Un correo que Resend RECHAZA tiene que oírse. Vive en la raíz de lib/,
      // así que sin esta línea la guarda existiría y no correría — que es el
      // mismo silencio que vino a vigilar.
      // Un byte de control crudo hace que grep trate el fichero ENTERO como
      // binario y no devuelva ni una linea: el codigo compila, los tests pasan
      // y solo se rompe la BUSQUEDA, en silencio. Eran 4 ficheros el 2026-09-04.
      // Vive en la raiz de lib/, asi que `include` —LISTA BLANCA— la necesita
      // nombrada: sin esta linea la guarda existiria y no correria, que es el
      // mismo silencio que vino a vigilar.
      "lib/fuente-sin-bytes-de-control.test.ts",
      "lib/etiquetas-de-esfuerzo.test.ts",
      "lib/email.test.ts",
      "lib/credits.test.ts",
      "lib/plan.test.ts",
      "lib/credits-client.test.ts",
      "components/app/credit-pill.test.tsx",
      // El reductor SSE de la superficie Crear: distingue el muro de créditos
      // de una generación fallida (reintentar no sirve para el primero).
      "lib/use-generation.test.ts",
      // Y el bucle de lectura entero, con React de verdad: un EOF sin evento
      // terminal no puede dejar el spinner girando para siempre.
      "lib/use-generation.stream.test.tsx",
      // Counter arithmetic of sanitizeForPublish. Lives at lib/ root beside the
      // module it covers; the older lib/html-engine.test.ts is node:test and
      // stays out of this runner.
      "lib/html-engine.sanitize-counters.test.ts",
      "lib/contract/**/*.test.ts",
      "lib/document/**/*.test.ts",
      "lib/evals/**/*.test.ts",
      "lib/page-engine/**/*.test.ts",
      "lib/generation/**/*.test.ts",
      "lib/html-gate/**/*.test.ts",
      "lib/ingestion/**/*.test.ts",
      // El rellenador escribia copia dentro de elementos aria-hidden.
      "lib/style-match/autofill/decorative-ops.test.ts",
      // La defensa SSRF del scraping. Vivía sin pruebas Y fuera de este include:
      // un test que no corre no protege nada.
      "lib/style-match/scrape/**/*.test.ts",
      "lib/style-match/extract/**/*.test.ts",
      "lib/style-match/direction.test.ts",
      "lib/style-match/character.test.ts",
      "lib/style-match/reference.test.ts",
      "lib/templates/visual-metadata.test.ts",
      "lib/templates/republicar-desde-disco.test.ts",
      "lib/templates/store-visual-metadata.test.ts",
      "lib/templates/suggest-visual-metadata.test.ts",
      "lib/templates/visual-metadata-review-workflow.test.ts",
      "lib/templates/visual-metadata-review-session.test.ts",
      "lib/templates/visual-metadata-review-session-store.test.ts",
      "lib/templates/visual-metadata-review-server.test.ts",
      "lib/templates/visual-metadata-review-launcher.test.ts",
      "lib/fs/**/*.test.ts",
      // lib/ai mixes runners — vision-critique.test.ts is node:test (in
      // test:node), so list the vitest ai tests individually.
      // `include` es LISTA BLANCA: un .test.ts que no esté aquí NO corre nunca.
      // El barredor de perfiles huerfanos de Chromium. `include` es LISTA
      // BLANCA: sin esta linea la guarda existiria y no correria.
      "lib/ai/perfiles-huerfanos.test.ts",
      "lib/ai/image-edit-core.test.ts",
      "lib/ai/fireworks-client.test.ts",
      // La carpeta (pieza 9 de Len 2.5): los ojos de Len cargan sus ficheros.
      "lib/ai/origen-de-medida-carpeta.test.ts",
      "lib/ai/fireworks-tool-client.test.ts",
      "lib/ai/fireworks-stream-client.test.ts",
      "lib/ai/provider-error-code.test.ts",
      "lib/ai/esfuerzo-no-admitido.test.ts",
      "lib/ai/origen-de-medida.browser.test.ts",
      // La carpeta (pieza 9 de Len 2.5), en un Chromium de verdad.
      "lib/ai/ojos-cargan-la-carpeta.browser.test.ts",
      // La suite de la página corriendo en Chromium de verdad: es la única que
      // puede decir si el programa con las promesas guardadas se ejecuta y si
      // lo que devuelve el navegador se reparte bien. LISTA BLANCA.
      "lib/agent/suite-de-la-pagina.browser.test.ts",
      "lib/agent/paginas-del-turno.browser.test.ts",
      "lib/ai/imagenes-perezosas.browser.test.ts",
      "lib/ai/sse.test.ts",
      // Que el latido este ENCHUFADO, no solo que exista: Crear latia desde
      // antes y las otras dos superficies llevaban meses mudas sin que nada se
      // pusiera rojo. Un turno callado 90 s lo corta Caddy y el usuario lee
      // "network error". `include` es LISTA BLANCA.
      "lib/ai/superficies-que-laten.test.ts",
      // Monta las CINCO superficies de prompt y comprueba que ninguna sigue
      // prohibiendo lo que la tubería ya permite. Ver su cabecera: cazó dos
      // defectos que todas las demás suites daban por verdes.
      "lib/ai/js-clause-superficies.test.ts",
      // Contadores de los ojos del Agente + paridad de claves de error entre
      // los 10 locales. Sin registrar aquí NO correria.
      "lib/ai/agent-eyes-y-errores.test.ts",
      // Hallazgo 15: las TRES superficies tienen que leer la memoria de la
      // persona. Sin registrar aqui NO correria.
      "lib/ai/memoria-en-las-tres-superficies.test.ts",
      "lib/ai/extract-document.test.ts",
      "lib/ai/authoring-rules.test.ts",
      "lib/ai/provider-switch.test.ts",
      "lib/ai/runtime-capability.test.ts",
      "lib/projects/page-runtimes.test.ts",
      "lib/projects/miniatura-en-vuelo.test.ts",
      // La carpeta (pieza 9 de Len 2.5): su huella publicable.
      "lib/projects/files-hash.test.ts",
      "lib/publish/model-runtime-locales.test.ts",
      // Un idioma pedido que no sale tiene que OÍRSE: el fallo era mudo y por
      // eso la traducción vivió cinco meses sin producir una sola página.
      "lib/publish/locales-fallidos.test.ts",
      "lib/page-engine/conservar-scripts.test.ts",
      "lib/ai/needs-image-eyes.test.ts",
      "lib/package-scripts-contract.test.ts",
      "lib/ai/turn-credentials.test.ts",
      "lib/ai/referencia-adjunta.test.ts",
      "lib/etiqueta-idioma.test.ts",
      // Sólo el fetch del adjunto (tope + plazo). El render de puppeteer del
      // mismo módulo NO se toca aquí: el import es dinámico y nunca corre.
      "lib/ai/inline-image.test.ts",
      // La suma de una corrida pagada. Un total que se queda corto NO detiene
      // la corrida — la deja seguir. `include` es LISTA BLANCA.
      "lib/ai/tarifas-eval.test.ts",
      "lib/ai/today-line.test.ts",
      "lib/ai/js-clause.test.ts",
      // Decodificador PNG y juicio de contraste: NÚCLEO PURO (sin navegador,
      // sin nativo, sin fs), extraído de dentro de `page.evaluate` para que se
      // pueda probar en milisegundos. `include` es LISTA BLANCA: sin estas dos
      // líneas los ficheros existen y NO CORREN NUNCA.
      "lib/ai/png-crudo.test.ts",
      "lib/ai/contraste.test.ts",
      "lib/ai/visual-quality-renderer.test.ts",
      "lib/ai/contraste-con-direccion.browser.test.ts",
      // El paseo por HERMANOS, que no heredó lo que el de ancestros ya sabía:
      // una foto no se juzga desde el CSS y un degradado es un velo. Sin esta
      // línea el fichero existe y NO CORRE NUNCA (`include` es lista blanca).
      // A QUIEN senala el detector de desborde. Vive en NAVEGADOR y no en
      // visual-quality-renderer.test.ts a proposito: aquella mockea page.evaluate,
      // asi que nunca ejecuta la sonda — el fallo vivio ahi dentro con la suite
      // en verde. include es LISTA BLANCA.
      "lib/ai/desborde-culpable.browser.test.ts",
      "lib/ai/contraste-hermanos.browser.test.ts",
      // Lo que está FIJO en la ventana no es el fondo del texto: la barra de
      // WhatsApp tapaba un precio en la captura y salía «acento sobre acento».
      "lib/ai/contraste-barra-fija.browser.test.ts",
      // El boton muerto: `<a href="#comprar">` sin `id="comprar"`. De navegador
      // por la misma razon que las dos de arriba, y sus contra-pruebas son la
      // mitad importante — `href="#"` a secas salio 45 veces en 12 de 16
      // paginas del corpus, y contarlo seria repetir lo del veredicto `prueba`.
      "lib/ai/enlaces-muertos.browser.test.ts",
      // Un `prompt()` en un manejador colgaba la medicion PARA SIEMPRE: pulsamos
      // todos los controles, el dialogo nativo bloquea la pagina y nadie lo
      // cerraba. Tumbo un turno en produccion el 2026-09-15. De navegador
      // obligatoriamente — visual-quality-renderer.test.ts mockea page.evaluate
      // y no abre un dialogo de verdad. `include` es LISTA BLANCA.
      "lib/ai/dialogos-nativos.browser.test.ts",
      // Lo que la página llama y el medidor no sirve (spec 2026-09-15, D6).
      // `include` es LISTA BLANCA.
      "lib/ai/llamadas-solo-publicada.browser.test.ts",
      // Y el tope que hace que el SIGUIENTE cuelgue no cueste un turno: ningun
      // render sin plazo, y al vencer se MATA el navegador en vez de soltar la
      // promesa (el pool encadena, asi que soltarla envenena a todos los que
      // vengan detras). `include` es LISTA BLANCA.
      "lib/ai/render-con-plazo.test.ts",
      // Y el mismo tope contra un Chromium DE VERDAD y con los numeros de
      // verdad: un `while (true)` en un manejador, que es el mismo sintoma que
      // el prompt() de produccion por otra puerta. Si alguien quita el plazo
      // "porque los dialogos ya se cierran", esta es la que se pone roja.
      "lib/ai/cuelgue-de-pagina.browser.test.ts",
      // Pulsar se lo comia la barra de navegacion: MEDIDO sobre las 16 paginas
      // de usuario de produccion con JS, de 136 botones reales pulsaba 5 (4%) y
      // en 11 de 16 pulsaba CERO. La prueba que ya existia usa una pagina de UN
      // boton, asi que el tope nunca se agota y lo tapaba. `include` es LISTA
      // BLANCA.
      "lib/ai/pulsar-apunta-a-los-controles.browser.test.ts",
      // La otra mitad del agujero de `imagenes-perezosas`: el CONTENIDO que el
      // modelo revela al bajar se fotografiaba a opacity 0 — 3 de 17 paginas
      // del cohorte. De navegador, y con el brazo de control dentro.
      "lib/ai/revelado-al-bajar.browser.test.ts",
      // `include` es LISTA BLANCA: sin esta linea la guarda del memo del render
      // NO CORRE NUNCA y `npm test` sale verde igual.
      "lib/ai/medir-una-vez.test.ts",
      // Los CINCO caminos por los que el CSS puede pintar un fondo y el paseo
      // por CSS no lo ve: mix-blend-mode, filter, backdrop-filter, un
      // pseudo-elemento y una cadena de opacity. MEDIDO el 2026-09-02: los
      // cinco estaban rotos, cuatro en falso negativo y tres en falso positivo.
      // `include` es LISTA BLANCA: sin esta línea no correría nunca.
      "lib/ai/contraste-caminos-css.browser.test.ts",
      // La prueba declarada, ejecutada de verdad: el modelo escribe el JS y los
      // primitivos llevan dentro la ventana, el conteo, el guardia y el censo
      // de clic muerto. Desde el 2026-09-22 es la única forma, así que aquí
      // viven también las protecciones que antes fijaban las pruebas del DSL
      // (selector, `required`, nombre, grupo, `atributo`, `estilo`, censo).
      // `include` es LISTA BLANCA: sin esta línea no correría nunca.
      "lib/agent/prueba-js.browser.test.ts",
      // H9: usar la página como un visitante, con un navegador de verdad y el
      // brazo de control dentro de cada prueba. `include` es LISTA BLANCA.
      "lib/agent/usar-pagina.browser.test.ts",
      "lib/agent/pasos-de-uso.test.ts",
      "lib/business-profiles/**/*.test.ts",
      "lib/billing/**/*.test.ts",
      "app/api/billing/**/*.test.ts",
      "lib/auth/**/*.test.ts",
      // NB: lib/agent mixes runners — tools.test.ts exercises the native
      // html-engine binding and runs under node:test (`tsx --test`), so list
      // the vitest agent tests individually (same reason as lib/projects).
      // El documento viejo se va del historial: el bucle reenvía todo lo
      // acumulado y una copia caducada es cara Y engañosa (sus op-id murieron).
      // EL GRABADOR de turnos: la mitad que le faltaba al replay. Nucleo puro
      // (sin fs, sin db, sin nativo) — pero `include` es LISTA BLANCA.
      // LA FORMA de un turno: lo que se manda, medido y sin contenido dentro.
      // Su prueba sujeta el invariante que justifica que vaya siempre
      // encendida — que no se escape nada del usuario a la linea de log.
      // Las ops del turno, resueltas a algo que NO caduca. Nucleo puro: los dos
      // ayudantes nativos entran inyectados. `include` es LISTA BLANCA.
      // El diario del turno: qué devolvió cada herramienta, podado de bulto.
      // `include` es LISTA BLANCA — sin esta línea la prueba existiría y no
      // correría, que es el silencio que este fichero avisa arriba dos veces.
      "lib/agent/diario-del-turno.test.ts",
      // H4 parte 3: el historial desde la base, con su microcompact.
      "lib/agent/transcripcion.test.ts",
      // A · las fotos de la conversación (del almacén en dev, de internet si
      // no). `include` es LISTA BLANCA: sin esta línea no correría.
      "lib/agent/fotos-de-la-conversacion.test.ts",
      // `include` es LISTA BLANCA: sin esta línea la prueba existe y NO corre.
      "lib/agent/motivo-del-fallo.test.ts",
      // N41: el motivo de un paso fallido, dicho para el dueño (código, no prosa).
      "lib/agent/owner-reason.test.ts",
      // La suite de la página: nace en verde y muere con su selector. LISTA
      // BLANCA — sin esta línea el fichero existe y no corre nadie.
      "lib/agent/pruebas-de-la-pagina.test.ts",
      // Los cinco eslabones del motivo. `include` es LISTA BLANCA.
      "lib/agent/motivo-llega-a-la-tarjeta.test.ts",
      "lib/agent/ops-descritas.test.ts",
      "lib/agent/forma-del-turno.test.ts",
      "lib/agent/grabacion.test.ts",
      // La POSTURA del Agente y su traducción a número. Núcleo puro (sin fs,
      // sin nativo, sin red) — pero `include` es LISTA BLANCA y sin esta línea
      // la prueba existiría y NO CORRERÍA NUNCA.
      "lib/agent/esfuerzo.test.ts",
      // Las CUATRO capas y quién gana. Núcleo puro — pero `include` es LISTA
      // BLANCA y sin esta línea la prueba existiría y NO CORRERÍA NUNCA.
      "lib/agent/esfuerzo-efectivo.test.ts",
      // El `race` contra un plazo, extraído (Task 5 R11) para que la lectura de
      // memoria y la de esfuerzo guardado no lo copien cada una la suya. Núcleo
      // puro (sin fs, sin db, sin nativo) — pero `include` es LISTA BLANCA y sin
      // esta línea la prueba existiría y NO CORRERÍA NUNCA.
      "lib/agent/con-plazo.test.ts",
      // La FRONTERA donde un string sin tipar de `users.agentEffort` entra al
      // sistema (hallazgo 4, revisión final 2026-09-11). Núcleo puro (DB
      // mockeada, sin red ni nativo) — pero `include` es LISTA BLANCA y sin
      // esta línea la prueba existiría y NO CORRERÍA NUNCA.
      "lib/agent/esfuerzo-guardado.test.ts",
      // R1: sin su línea aquí un .test.ts existe, compila y NO CORRE NUNCA
      // (el `include` es lista blanca fichero a fichero, no un glob).
      "app/api/agent/esfuerzo/route.test.ts",
      // Su gemela para el selector de modelo de Crear: la frontera donde entra
      // lo que elige el navegador. Misma razón y misma lista blanca — sin esta
      // línea el fichero existe, compila y NO CORRE NUNCA.
      "app/api/crear/escritor/route.test.ts",
      "app/api/auth/register/route.test.ts",
      // POST y GET del lienzo servido desde su propio origen (spec 2026-09-15).
      // `include` es LISTA BLANCA.
      "app/api/lienzo/route.test.ts",
      "app/api/assistant/[sub]/route.test.ts",
      "app/api/lienzo/[docId]/route.test.ts",
      // El lienzo sirve el sitio entero (pieza 9 de Len 2.5).
      "app/api/lienzo/site/**/*.test.ts",
      "lib/lecturas-de-users-proyectan.test.ts",
      "lib/ninguna-prueba-a-oscuras.test.ts",
      "components/workspace-v2/panels/mando-esfuerzo.test.tsx",
      // El selector de modelo de Crear: lo que enseña (fila de defecto, la del
      // razonador apagada con motivo cuando hay imagen) y cómo se sale (Esc,
      // clic fuera, flechas — el gancho compartido `use-mando-desplegable`).
      // `include` es LISTA BLANCA: sin esta línea existiría y no correría nunca.
      "components/workspace-v2/selector-de-modelo.test.tsx",
      "lib/agent/brain.test.ts",
      // Len Dynamis (lib/agent/dynamis.ts): del cuerpo del turno a lo que lee el
      // modelo. `include` es LISTA BLANCA: sin esta línea no correría nunca.
      "lib/agent/dynamis.test.ts",
      // El arnes multiturno dice cablear el bucle «como en produccion»; esto
      // lo comprueba contra app/api/agent/route.ts. `include` es LISTA
      // BLANCA: sin esta linea la guarda existiria y no correria.
      // Los ojos del arnés de evals: sin esto vuelve a mirar sin `spec` ni
      // `guardadas`. LISTA BLANCA.
      "lib/agent/catalog.test.ts",
      // Len 2.0: el sitio como ficheros, con el contrato de Read/Edit/Write/
      // Grep/Glob de Claude Code (plans/len-2/ficheros-plan.md). Piezas puras.
      "lib/agent/ficheros/**/*.test.ts",
      // …y lo que vuelve tras editar: `<new-diagnostics>` anclados a línea.
      "lib/agent/diagnosticos.test.ts",
      "lib/agent/diagnosticos-de-la-escritura.test.ts",
      "lib/agent/fireworks-bridge.test.ts",
      // La guarda de que la politica de modelos no cria filas muertas. `include`
      // es LISTA BLANCA: sin esta linea no corre nunca.
      "lib/generation/model-policy-sin-huerfanas.test.ts",
      "lib/agent/loop.test.ts",
      "lib/agent/write-preview.test.ts",
      // La compactación dentro del turno (pieza 2 de Len 2.5): todo el módulo.
      "lib/agent/compaction/**/*.test.ts",
      "lib/agent/retry-policy.test.ts",
      // Pieza 4 de Len 2.5: herramientas en paralelo, como DeepSeek. LISTA BLANCA.
      "lib/agent/tool-concurrency.test.ts",
      "lib/agent/tool-scheduler.test.ts",
      "lib/agent/concurrency-limit.test.ts",
      // Pieza 3 de Len 2.5: ask_user_question, como DeepSeek. LISTA BLANCA.
      "lib/agent/ask-user-question.test.ts",
      "lib/agent/historial-saneado.test.ts",
      // Pieza 5 de Len 2.5: buscar en las charlas, como session-query de DeepSeek.
      "lib/agent/session-query.test.ts",
      "lib/agent/session-query-tools.test.ts",
      // Pieza 7 de Len 2.5: el modo plan, como DeepSeek. LISTA BLANCA.
      "lib/agent/plan-mode.test.ts",
      "lib/agent/plan-mode-tools.test.ts",
      // Pieza 8 de Len 2.5: el encargo (el goal de DeepSeek).
      "lib/agent/goal.test.ts",
      "lib/agent/goal-activation.test.ts",
      "lib/agent/goal-tools.test.ts",
      "lib/projects/chat-row.test.ts",
      // Lote 7-8: el SQL de jsonb del estado de la charla contra PGlite.
      "lib/projects/chat-estado.pglite.test.ts",
      // Deshacer lo de Len sobre lo que hay AHORA, sin llevarse lo que el dueño
      // editó a mano (H06, auditoría 2026-09-22). Núcleo puro — pero `include`
      // es LISTA BLANCA y sin esta línea la prueba existiría y no correría.
      "lib/agent/deshacer-lo-de-len.test.ts",
      // Lo que el dueño cambió a mano desde el último turno de Len (H07). Núcleo
      // puro — `include` es LISTA BLANCA.
      "lib/agent/cambios-del-dueno.test.ts",
      // La fila del turno y la decisión de si se cortó (H05). Núcleo puro —
      // `include` es LISTA BLANCA.
      "lib/agent/registro-del-turno.test.ts",
      // El prefijo de país que nadie dio (H09). Núcleo puro — LISTA BLANCA.
      "lib/agent/prefijo-inventado.test.ts",
      // Precios, cifras y reseñas que nadie dio (H13). Núcleo puro — LISTA BLANCA.
      "lib/agent/datos-inventados.test.ts",
      // La librería que en el lienzo va y publicada no. Núcleo puro — LISTA BLANCA.
      "lib/agent/librerias-que-no-cargan.test.ts",
      // El enlace que cae en la portada. Núcleo puro — LISTA BLANCA.
      "lib/agent/enlaces-que-no-llegan.test.ts",
      // Lo medido que vuelve al modelo tras editar. `include` es LISTA BLANCA:
      // sin esta línea la prueba existiría y no correría nunca.
      "lib/agent/aviso-medido.test.ts",
      "lib/agent/retry.test.ts",
      "lib/agent/reloj-de-silencio.test.ts",
      "lib/agent/context.test.ts",
      "lib/agent/manual-de-la-plataforma.test.ts",
      "lib/agent/subagente.test.ts",
      "lib/agent/facts-kept.test.ts",
      "lib/agent/contenido-perdido.test.ts",
      // Lo puro de la prueba declarada: leer lo que devuelve el navegador, la
      // nota de sus fallos y la entrada. `include` es LISTA BLANCA.
      "lib/agent/prueba-js.test.ts",
      "lib/agent/user-memory-block.test.ts",
      "lib/agent/memoria-larga.test.ts",
      "lib/agent/photo-search.test.ts",
      // La guarda de cuentas de red INVENTADAS. Nucleo puro (dos cadenas y
      // unos textos), sin binding nativo — pero `include` es LISTA BLANCA y sin
      // esta linea no correria nunca.
      "lib/agent/enlaces-inventados.test.ts",
      // Un enlace que DICE un numero y MARCA otro. Nucleo puro (una cadena a
      // una lista), pero `include` es LISTA BLANCA y sin esta linea no correria.
      "lib/agent/enlaces-desfasados.test.ts",
      // El boton que nace MUDO: `onclick=` se borra al guardar y no lo ve nadie
      // — ni la consola, ni la captura, ni el critico. `include` es LISTA BLANCA.
      // Corregirle el rumbo al Agente a media faena. Nucleo puro (un Map),
      // pero `include` es LISTA BLANCA y sin esta linea no correria nunca.
      "lib/agent/direcciones.test.ts",
      // Len 2.1: la fila del turno se guarda a medida que pasa, sin martillear.
      "lib/agent/avance-del-turno.test.ts",
      // Len 2.1: el aviso de que Len terminó sin nadie mirando.
      "lib/agent/aviso-del-turno.test.ts",
      // Internet: fetch de URL a texto. El fetcher se inyecta, así que no toca
      // la red ni el binding nativo — pero `include` es LISTA BLANCA y sin esta
      // línea no correría nunca.
      // Len sabe de tus resultados: las herramientas, con dobles (plans/len-resultados/).
      "lib/agent/resultados.test.ts",
      // ⚰️ Aquí estaba "lib/agent/business.test.ts", que NO EXISTE — el fichero
      // se fue con el perfil de negocio y la entrada se quedó. vitest ignora en
      // silencio un patrón sin match, así que no rompía nada: sólo APARENTABA
      // cobertura a quien leyera esta lista. Retirada el 2026-09-01.
      // Shape-only eval-battery test — no Gemini, no DB (the harness/runner are
      // what spend credits and are NEVER in the test suite / CI).
      // Las guardas del experimento de los dos sobres: que el brazo de CONTROL
      // no sea en secreto igual al de tratamiento. `include` es LISTA BLANCA.
      "lib/theme-derive.test.ts",
      "lib/palette-gen-look.test.ts",
      "lib/theme-presets.test.ts",
      "lib/gradients.test.ts",
      "lib/tematicas/**/*.test.ts",
      "lib/site-assistant/**/*.test.ts",
      "lib/publish/assistant-widget.test.ts",
      // `lib/publish/**` entra fichero a fichero, no por directorio: es la
      // convención de arriba y hay pruebas ahí que necesitan el binding nativo.
      "lib/publish/form-identity.test.ts",
      // La carpeta (pieza 9 de Len 2.5): el service worker que se da de baja.
      "lib/publish/service-worker.test.ts",
      // La guarda de las veinte frases que ve el visitante al enviar un
      // formulario: viven duplicadas dentro del guion de Rust y sin esta línea
      // la copia se pudriría en silencio (medido en producción el 19/09).
      "lib/publish/forms-i18n.test.ts",
      "lib/publish/llms-txt.test.ts",
      "lib/publish/video-embed.test.ts",
      // El `include` es LISTA BLANCA: sin esta línea el fichero existe, pasa
      // `tsc` y NO CORRE NUNCA — una prueba que no corre no protege nada.
      "lib/publish/map-embed.test.ts",
      // DB-integration test (real Postgres via .env.local, same pattern as
      // lib/chat/identity-bridge.test.ts) — preview-bake.test.ts itself stays
      // on node:test (no DB env there), so this lives as its own file.
      "lib/publish/whatsapp-button.test.ts",
      "lib/publish/module-markup-tailwind.test.ts",
      "lib/publish/embed-sandbox.test.ts",
      // La guarda SSRF tampoco deja salir las ventanas que abre la página.
      "lib/security/render-ssrf-guard.browser.test.ts",
      // Y el proxy de salida, por debajo de todas las pestañas: WebSocket,
      // rebinding y ventanas con clic real. `include` es LISTA BLANCA.
      "lib/security/egress-proxy.test.ts",
      "lib/security/egress-proxy.browser.test.ts",
      "lib/publish/model-runtime-e2e.test.ts",
      "lib/publish/request-origin.test.ts",
      "lib/publish/cloudflare-email.test.ts",
      "lib/custom-domains-validate.test.ts",
      // Vive en la raiz de lib/subdomain/, que no estaba en el include: la
      // lista de reservados no la vigilaba NADIE hasta el 2026-09-01.
      "lib/subdomain/reserved.test.ts",
      // El lienzo servido desde su propio origen (spec 2026-09-15). Núcleo puro
      // salvo `documento.ts` (binding nativo, que vitest SÍ carga). `include`
      // es LISTA BLANCA: sin esta línea estas pruebas no corren nunca.
      "lib/lienzo/**/*.test.ts",
      "lib/publish/base-host.test.ts",
      "lib/publish/bake-surfaces.test.ts",
      "lib/publish/frame-origins.test.ts",
      "lib/publish/kill-switches.test.ts",
      "lib/publish/tw-config.test.ts",
      "lib/publish/design-stash-strip.test.ts",
      "lib/publish/chat-widget.test.ts",
      "lib/chat/**/*.test.ts",
      "lib/community/**/*.test.ts",
      "lib/marketing/**/*.test.ts",
      // Inbox badge (Results loop P2) — prevents silent skip on new test files
      "lib/inbox/**/*.test.ts",
      "components/inbox/**/*.test.ts",
      "components/inbox/**/*.test.tsx",
      "infra/status-worker/**/*.test.ts",
      // Route guard for the one-time Explore seed trigger. Mocks the seed core,
      // so it never loads the native html-engine binding.
      "app/api/admin/explore-seed/route.test.ts",
      "app/api/admin/templates/[id]/route.test.ts",
      "app/api/internal/republish-templates/route.test.ts",
      "app/api/internal/republish/route.test.ts",
      // Fail-closed pin for one of the three edit surfaces on the html gate.
      // Unlike the routes above it does NOT mock @/lib/html-engine — the real
      // sanitize/normalize load fine here, and mocking them would mock away
      // the pipeline order the test exists to hold still.
      // La ruta que le da SUPERFICIE al brief del proyecto. Mockea
      // @/lib/projects entero porque su cadena arrastra el binding nativo.
      // `include` es LISTA BLANCA: sin esta linea no correria.
      "app/api/projects/[id]/brief/route.test.ts",
      // El esquema del guardado del chat: qué campos de la tarjeta sobreviven.
      "app/api/projects/[id]/chat/route.test.ts",
      "app/api/projects/[id]/apply-template/route.test.ts",
      // La terminal del usuario (la #17 de plans/len-agente-2026/notas/fase-5-taller.md).
      "app/api/projects/[id]/terminal/route.test.ts",
      // Editar a mano en la lente «Código» (la #18).
      "app/api/projects/[id]/ficheros/route.test.ts",
      // Deshacer un fichero de la carpeta (pieza 9 de Len 2.5).
      "app/api/projects/*/ficheros/versions/**/*.test.ts",
      // Exportar lleva la carpeta (pieza 9 de Len 2.5).
      "app/api/export/zip/route.test.ts",
      // «Abrir en pestaña» se va al lienzo en .app; lo que queda aquí, opaco.
      "app/api/projects/[id]/raw/route.test.ts",
      // Un dominio propio sólo se sirve en su propio host, nunca en openlen.com.
      // (por carpeta: los corchetes de `[[...path]]` el glob los lee como clase)
      "app/served/**/*.test.ts",
      // Same, for the Chat surface. Mocks only the model, DB, auth and
      // credits — the sanitize/normalize/behaviour passes are the real ones.
      "app/api/templates/ai-design/route.test.ts",
      "app/api/agent/route.test.ts",
      // Pieza 3 de Len 2.5: la respuesta del dueño a ask_user_question.
      "app/api/agent/responder/route.test.ts",
      // Contestar deja la conversación leída: el «Enviar» del borrador de Len.
      "app/api/inbox/[conversationId]/reply/route.test.ts",
      // Len 2.1: volver a mirar un turno que sigue trabajando sin cliente.
      "app/api/agent/turno/[fila]/route.test.ts",
      // Pieza 8: quitar el encargo.
      "app/api/agent/encargo/route.test.ts",
      "app/api/usage/route.test.ts",
      // Task 5 — the fill surface that had no gate at all. Mocks fillTemplate
      // so the test drives the route's gate, not the filler's own sanitizer.
      "app/api/templates/autofill/route.test.ts",
      // Task 4 — the two fail-open ingestion surfaces.
      "app/api/projects/from-html/route.test.ts",
      "app/api/projects/from-template/route.test.ts",
      // Task 4 step 3 — the AI creation surface. Ran four mutations after its
      // last sanitize and validated behaviours after the row was written.
      "app/api/generate/route.test.ts",
      "app/api/generate/system-prompt.test.ts",
      // Los eventos de uso (lib/uso/ y su ruta). LISTA BLANCA: sin estas dos
      // líneas sus pruebas no correrían y la puerta saldría verde igual.
      "lib/uso/**/*.test.ts",
      "app/api/uso/route.test.ts",
      // Uno a uno, NO un glob: `lib/ai-stream/` tiene además pruebas escritas
      // con `node:test` (generate, model-runtime-capture) que corren en el otro
      // runner (`npm run test:node`); barrerlas aquí las hace fallar con "No
      // test suite found" aunque estén sanas. Y ojo — `include` es una LISTA
      // BLANCA: un fichero nuevo NO CORRE hasta aparecer aquí.
      "lib/ai-stream/model-runtime.test.ts",
      "lib/ai-stream/inject-model-runtime.test.ts",
      "lib/ai-stream/model-prueba.test.ts",
      "lib/ai-stream/document-ops.test.ts",
      // NB: lib/projects/site-pages.test.ts is a node:test file (run via
      // `tsx --test`), so include the vitest project tests explicitly.
      "lib/projects/model-runtime.test.ts",
      "lib/projects/runtime-staleness.test.ts",
      "lib/projects/module-intent.test.ts",
      "lib/projects/page-edge-paths.test.ts",
      "lib/projects/preview.test.ts",
      "lib/projects/settings-patch.test.ts",
      "lib/projects/create-page.test.ts",
      "lib/projects/paginas-declaradas.test.ts",
      // Las copias de ANTES no entran en el registro que ve el Agente.
      "lib/projects/cambios-para-el-agente.test.ts",
      "lib/projects/construir-paginas-declaradas.test.ts",
      "lib/projects/inline-own-assets.test.ts",
      "lib/projects/assets-config.test.ts",
      "lib/projects/drift-pill.test.ts",
      "lib/projects/dismiss-degradations.test.ts",
      // Borrar un proyecto se lleva la base de su página (04/10).
      "lib/projects/delete-project.test.ts",
      // I4 — el primitivo de escritura con compare-and-swap y su guardia.
      "lib/projects/escribir-data.test.ts",
      // 🔴 CONTRA POSTGRES DE VERDAD. La de arriba dobla la base y por eso no
      // pudo cazar el truncado a milisegundos que tumbó las ediciones en
      // producción el 2026-09-15. Sin esta línea no correría — lista BLANCA.
      "lib/projects/escribir-data.pg.test.ts",
      // Len 2.1: la fila del turno en curso, contra Postgres (sólo base local).
      "lib/projects/chat-en-curso.pg.test.ts",
      // El chat nuevo: las charlas archivables y el 👍/👎 (plans/new-chat/).
      "lib/projects/chat-conversations.pg.test.ts",
      "lib/projects/escritores-de-data.test.ts",
      "lib/notifications/**/*.test.ts",
    ],
    exclude: [
      "node_modules/**",
      "tests/e2e/**",
      ".next/**",
      // node:test file (run via `tsx --test`, part of test:node) — would
      // otherwise get swept up by the lib/tematicas/**/*.test.ts wildcard
      // above and fail with "No test suite found" under vitest.
      "lib/tematicas/apply-server.test.ts",
      // ⚰️ Aqui, en esta MISMA linea, vivia tambien
      // `lib/generation/fable-parity-review-session.test.ts`, y el comentario de
      // arriba no le valia: ese fichero importa de `"vitest"` —no de
      // `node:test`— y NO esta en la lista de `test:node`. O sea que no lo corria
      // NADIE. Se le pregunto al runner en vez de a la config
      // (`npx vitest list --filesOnly`): 398 ficheros en disco, 346 los corre
      // vitest, 37 `test:node`, y ese era el unico oscuro de verdad fuera de
      // `scratch/`. Retirado del exclude el 2026-09-12.
    ],
  },
});
