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
      // lib/conductas-heredadas/validate.ts (and any future server-only module) imports
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
      // `include` es una LISTA BLANCA: un .test.ts fuera de ella NO corre, y
      // pasa desapercibido porque `npm test` sale verde igual.
      "lib/page-data/**/*.test.ts",
      "lib/conductas-heredadas/**/*.test.ts",
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
      "lib/email.test.ts",
      "lib/credits.test.ts",
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
      "lib/expr/**/*.test.ts",
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
      "lib/ai/image-edit-core.test.ts",
      "lib/ai/fireworks-client.test.ts",
      "lib/ai/fireworks-tool-client.test.ts",
      "lib/ai/fireworks-stream-client.test.ts",
      "lib/ai/origen-de-medida.browser.test.ts",
      "lib/ai/imagenes-perezosas.browser.test.ts",
      "lib/ai/sse.test.ts",
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
      "lib/ai/qwen-visual-critic.test.ts",
      "lib/ai/today-line.test.ts",
      "lib/ai/js-clause.test.ts",
      "lib/ai/visual-quality-renderer.test.ts",
      "lib/ai/contraste-con-direccion.browser.test.ts",
      // El paseo por HERMANOS, que no heredó lo que el de ancestros ya sabía:
      // una foto no se juzga desde el CSS y un degradado es un velo. Sin esta
      // línea el fichero existe y NO CORRE NUNCA (`include` es lista blanca).
      "lib/ai/contraste-hermanos.browser.test.ts",
      "lib/business-profiles/**/*.test.ts",
      "lib/billing/**/*.test.ts",
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
      "lib/agent/ops-descritas.test.ts",
      "lib/agent/forma-del-turno.test.ts",
      "lib/agent/grabacion.test.ts",
      "lib/agent/podar-documentos.test.ts",
      "lib/agent/brain.test.ts",
      "lib/agent/catalog.test.ts",
      "lib/agent/fireworks-bridge.test.ts",
      "lib/agent/loop.test.ts",
      "lib/agent/retry.test.ts",
      "lib/agent/context.test.ts",
      "lib/agent/facts-kept.test.ts",
      "lib/agent/contenido-perdido.test.ts",
      "lib/agent/behavior-spec.test.ts",
      "lib/agent/user-memory-block.test.ts",
      "lib/agent/memoria-larga.test.ts",
      "lib/agent/photo-search.test.ts",
      // El buscador de texto del Agente. Núcleo puro (recibe el documento ya
      // etiquetado), así que NO toca el binding nativo y corre aquí — pero
      // `include` es LISTA BLANCA y sin esta línea no correría nunca.
      "lib/agent/buscar-en-pagina.test.ts",
      // La guarda de cuentas de red INVENTADAS. Nucleo puro (dos cadenas y
      // unos textos), sin binding nativo — pero `include` es LISTA BLANCA y sin
      // esta linea no correria nunca.
      "lib/agent/enlaces-inventados.test.ts",
      // Internet: fetch de URL a texto. El fetcher se inyecta, así que no toca
      // la red ni el binding nativo — pero `include` es LISTA BLANCA y sin esta
      // línea no correría nunca.
      "lib/agent/internet.test.ts",
      // ⚰️ Aquí estaba "lib/agent/business.test.ts", que NO EXISTE — el fichero
      // se fue con el perfil de negocio y la entrada se quedó. vitest ignora en
      // silencio un patrón sin match, así que no rompía nada: sólo APARENTABA
      // cobertura a quien leyera esta lista. Retirada el 2026-09-01.
      // Shape-only eval-battery test — no Gemini, no DB (the harness/runner are
      // what spend credits and are NEVER in the test suite / CI).
      "lib/agent/evals/cases.test.ts",
      "lib/agent/evals/eval-identity.test.ts",
      "lib/theme-derive.test.ts",
      "lib/palette-gen-look.test.ts",
      "lib/theme-presets.test.ts",
      "lib/gradients.test.ts",
      "lib/tematicas/**/*.test.ts",
      "lib/site-assistant/**/*.test.ts",
      "lib/publish/assistant-widget.test.ts",
      // `lib/publish/**` entra fichero a fichero, no por directorio: es la
      // convención de arriba y hay pruebas ahí que necesitan el binding nativo.
      "lib/publish/bake-lectura.test.ts",
      "lib/publish/module-sections-vivos.test.ts",
      "lib/publish/form-identity.test.ts",
      "lib/publish/llms-txt.test.ts",
      "lib/publish/video-embed.test.ts",
      // El `include` es LISTA BLANCA: sin esta línea el fichero existe, pasa
      // `tsc` y NO CORRE NUNCA — una prueba que no corre no protege nada.
      "lib/publish/map-embed.test.ts",
      "lib/publish/module-sections.test.ts",
      // DB-integration test (real Postgres via .env.local, same pattern as
      // lib/chat/identity-bridge.test.ts) — preview-bake.test.ts itself stays
      // on node:test (no DB env there), so this lives as its own file.
      "lib/publish/whatsapp-button.test.ts",
      "lib/publish/module-markup-tailwind.test.ts",
      "lib/publish/embed-sandbox.test.ts",
      "lib/publish/model-runtime-e2e.test.ts",
      "lib/publish/request-origin.test.ts",
      "lib/publish/cloudflare-email.test.ts",
      "lib/custom-domains-validate.test.ts",
      // Vive en la raiz de lib/subdomain/, que no estaba en el include: la
      // lista de reservados no la vigilaba NADIE hasta el 2026-09-01.
      "lib/subdomain/reserved.test.ts",
      "lib/publish/base-host.test.ts",
      "lib/publish/bake-surfaces.test.ts",
      "lib/publish/frame-origins.test.ts",
      "lib/publish/kill-switches.test.ts",
      "lib/publish/tw-config.test.ts",
      "lib/publish/design-stash-strip.test.ts",
      "lib/transform/**/*.test.ts",
      // Datos vivos (spec 2026-07-14) — el directorio aún no existe (Task 1
      // solo prepara el terreno). Listado por adelantado porque el include
      // de este repo es per-file: sin esta entrada, los tests que Task 2+
      // agreguen bajo lib/live/ correrían silenciosamente en ningún lado.
      "lib/live/**/*.test.ts",
      "lib/publish/chat-widget.test.ts",
      "lib/chat/**/*.test.ts",
      "lib/community/**/*.test.ts",
      "lib/marketing/**/*.test.ts",
      // Inbox badge (Results loop P2) — prevents silent skip on new test files
      "lib/inbox/**/*.test.ts",
      "components/inbox/**/*.test.ts",
      "infra/status-worker/**/*.test.ts",
      // Route guard for the one-time Explore seed trigger. Mocks the seed core,
      // so it never loads the native html-engine binding.
      "app/api/admin/explore-seed/route.test.ts",
      "app/api/admin/templates/[id]/route.test.ts",
      // Route guard for the internal live-republish trigger (Task 12). Mocks
      // lib/live/deps for the same reason — its import chain reaches the
      // native html-engine binding via lib/projects.ts.
      "app/api/internal/live-republish/route.test.ts",
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
      "app/api/projects/[id]/apply-template/route.test.ts",
      // Same, for the Chat surface. Mocks only the model, DB, auth and
      // credits — the sanitize/normalize/behaviour passes are the real ones.
      "app/api/templates/ai-design/route.test.ts",
      "app/api/agent/route.test.ts",
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
      "lib/projects/construir-paginas-declaradas.test.ts",
      "lib/projects/inline-own-assets.test.ts",
      "lib/projects/assets-config.test.ts",
      "lib/projects/drift-pill.test.ts",
      "lib/projects/dismiss-degradations.test.ts",
      "lib/notifications/**/*.test.ts",
    ],
    exclude: [
      "node_modules/**",
      "tests/e2e/**",
      ".next/**",
      // node:test file (run via `tsx --test`, part of test:node) — would
      // otherwise get swept up by the lib/tematicas/**/*.test.ts wildcard
      // above and fail with "No test suite found" under vitest.
      "lib/tematicas/apply-server.test.ts", "lib/generation/fable-parity-review-session.test.ts",
    ],
  },
});
