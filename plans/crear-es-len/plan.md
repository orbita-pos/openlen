# Crear es Len — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que crear una página sea el primer mensaje a Len en un proyecto en blanco, igual que una sesión nueva de DeepSeek, y que `/api/generate` desaparezca.

**Architecture:**
- Los argumentos de las herramientas ya llegan a trozos desde Fireworks. Se reenvían en vivo, así el lienzo pinta el `Write` de una página mientras se escribe.
- `/new` abre un proyecto en blanco reutilizable. La pantalla de entrada pasa a ser el estado vacío del chat de Len, y enviar es un mensaje normal a `/api/agent`, con varias fotos y la referencia por URL.
- Lo que sólo sabía Crear entra en la guía de diseño que Len ya lee antes de escribir desde cero.
- Al final se quitan las dos mediciones automáticas que DeepSeek no tiene (`verifyTurn` al cerrar y `medirParaElModelo` tras cada edición), se mide lado a lado (pagado, con OK) y se borra Crear.

**Tech Stack:** Next.js (App Router) + TypeScript, Drizzle/Postgres, vitest (`include` = lista blanca), Fireworks (SSE de OpenAI).

**Spec:** `plans/crear-es-len/diseno.md` (aprobada por Jesús el 2026-10-06). Lee las dos cosas antes de empezar.

## Ejecución en la nube (decidido por Jesús el 2026-10-06)

Se ejecuta en una sesión de **Claude Code en la nube**, con los **100 $ de crédito de nube** de Jesús.

- **Rama**: `crear-es-len`, ya en `origin` con `plans/crear-es-len/diseno.md` y `plan.md`. `plans/` está en `.gitignore`: para commitear algo de esa carpeta, `git add -f`. Si la sesión arranca en `master`, primero `git fetch origin crear-es-len && git switch crear-es-len`.
- **Alcance en la nube: Tareas 1 a 10 de este plan, después la Parte B entera (`plans/crear-es-len/plan-herramientas.md`, Tareas B1 a B4: las 11 herramientas en inglés), y PARAR.** La Parte B va después de la 10 porque renombra también lo que la Parte A escribe.
  - La 11 (medición pagada, con Fireworks de verdad y el OK de Jesús) no se hace en la nube.
  - La 12 (borrar Crear) depende de la 11, así que tampoco.
- **Lo que no se puede hacer allí** se anota en `plans/crear-es-len/pendiente-local.md` (tarea, paso, por qué) y se sigue:
  - los `*.pg.test.ts`. No hay base local de 5546. Si el entorno deja levantar un Postgres de usar y tirar en 127.0.0.1, sí se puede: `exigirBaseLocal()` lo comprueba solo;
  - las verificaciones en el navegador (Tarea 3 paso 9, Tarea 9 paso 9);
  - todo lo que necesite claves reales.
- **Entorno**: Linux, sin `.env.local`. Eso es bueno: no hay producción a la que llegar por error.
  - Instalar con `npm ci`. Si fallan los crates nativos (`@openlen/*` son `file:./crates/*`, en Rust), usar `npm ci --ignore-scripts`: ni `npm run typecheck` ni la lista blanca de vitest cargan los `.node`.
- **Variables para las pruebas**:
  - `FIREWORKS_API_KEY=fake-test-key`: es falsa, así que si algo llamara de verdad sería un 401 sin gasto;
  - `NEXT_PUBLIC_PUBLISH_BASE_HOST=openlen.app`, para `prompts-golden` (el host de producción según `CLAUDE.md`). Si la golden sale distinta **sólo en el host**, no se regraba: se anota en pendiente-local.
- **Fallos que no son del cambio**: hay suites que ya fallan en `master` por falta de entorno (memoria `npm-test-en-worktree-sin-env-local`: `*.pg`, notificaciones, el launcher). Antes de culpar al cambio, corre ese fichero en `master`.
- **Las notas de Windows** (Git Bash, heredocs con NUL, el clon incompleto de DeepSeek) no aplican en Linux. Allí el clon de DeepSeek sale entero.
- **Después de CADA tarea**: puertas, commit y `git push origin crear-es-len`. Si se acaba el crédito, no se pierde nada.
- **Gasto**:
  - nada de Fireworks ni de herramientas de pago;
  - nada de subagentes salvo que de verdad hagan falta, porque cada uno paga un contexto entero;
  - lee los ficheros grandes por tramos (`page.tsx` tiene ~3.900 líneas, `loop.ts` ~2.500 y `route.ts` ~2.100), no enteros.
- **Nunca**: desplegar, empujar a `master`, ni abrir un PR sin que Jesús lo pida.
- **Al terminar la Tarea 10** (o si algo bloquea): escribe `plans/crear-es-len/estado.md` con qué se hizo, qué pruebas pasaron y qué queda en pendiente-local. Commitea con `-f`, haz push y para.

## Global Constraints

- **Regla de diseño: igual que DeepSeek** (`deepseek-ai/deepseek-harness`). Si una decisión no está en este plan, se copia lo que hace DeepSeek. Para clonarlo: `git clone --depth 1 --filter=blob:limit=1m https://github.com/deepseek-ai/deepseek-harness.git` en el scratchpad. ⚠️ **En Windows el clon sale incompleto** (rutas largas: faltan `packages/hooks`, `tools`, `llm`, `lsp`…). Lee con `git show HEAD:<ruta>` o `git grep … HEAD`, no del disco.
- **Nombres nuevos** (funciones, variables, ficheros, carpetas) **en inglés**. Lo existente en español no se renombra. Los comentarios y títulos de prueba van en el idioma del fichero (aquí, español).
- **Nunca desplegar.** No se corre `npm run deploy:prod` ni nada contra producción. Un solo despliegue al final, sólo si Jesús lo pide.
- ⚠️ **`DATABASE_URL` de `.env.local` ES PRODUCCIÓN.** Cualquier `*.pg.test.ts` o script con base corre contra la base local de usar y tirar (puerto 5546, ver memoria `turnos-reales-en-local-con-base-de-usar-y-tirar`) y llama a `exigirBaseLocal()` (`lib/len-bench/entorno.ts:115`).
- **Pruebas: sólo los ficheros tocados**, en una invocación pequeña: `npx vitest run <ficheros>`. Nunca carpetas enteras (satura la máquina). Un `*.test.ts` nuevo **no corre** hasta que se añade a `include` en `vitest.config.ts`.
- **Puertas antes de cada commit**: `npm run typecheck` y `npx eslint <ficheros tocados>`.
- **Nunca Turbopack** para verificar en el navegador: build de producción en 127.0.0.1 (ver memoria `un-deploy-con-todo-ensayo-de-caja-antes`). No hacer build con el dev encendido.
- **Rama**: trabajar en `crear-es-len`, sacada de `master` (`git switch -c crear-es-len`). No commitear en `master`. No crear worktrees con `node_modules` enlazado.
- **Ficheros**: escribir con la herramienta de edición, no con heredocs (dejan bytes NUL). En Git Bash, `//` se convierte en `/`.
- **Medir cuesta dinero**: la Tarea 11 no se corre sin presupuesto escrito y OK de Jesús.

## Review Focus

1. **Un trozo corta un escape JSON** (`\"`, `\n`, `é`, la barra sola). El lienzo nunca pinta basura; se espera al trozo siguiente. → pruebas en la Tarea 2.
2. **El turno falla después de pintar una vista previa** (un guarda rechaza el `Write`, la red cae, se cancela). El lienzo vuelve al documento de antes del turno, no se queda con medio HTML. → paso de restauración y prueba manual en la Tarea 3.
3. **Un proyecto con conversación pero sin HTML** (Len falló antes de escribir) **no está en blanco**. No se reutiliza ni se oculta: es del usuario. → pruebas en la Tarea 6.
4. **Un título puesto a mano nunca se pisa** con el `<title>` de la página. Sólo se cambia el de relleno. → prueba en la Tarea 5.
5. **Un enlace viejo de la portada con `autostart=1`** rellena el compositor y **no envía**. → paso y prueba manual en la Tarea 9.

---

## Mapa de ficheros

| Fichero | Qué cambia |
|---|---|
| `lib/ai/fireworks-stream-client.ts` | Evento `function_call_delta`, opcional con `streamToolArgs` |
| `lib/ai-gateway.ts` | `StreamEvent` suma `function_call_delta` |
| `lib/agent/write-preview.ts` (nuevo) | `readPartialWrite` + `createWritePreview`: puro |
| `lib/agent/brain.ts` | Pide `streamToolArgs` cuando hay herramientas |
| `lib/agent/loop.ts` | Emite `page_preview`; después se quita `verifyTurn` |
| `components/workspace-v2/chat/use-agent-chat.ts` | Pinta `page_preview`, restaura al fallar, varias fotos, referencia |
| `lib/agent/manual-de-la-plataforma.ts` | Bloque `FROM_SCRATCH` dentro de la guía de diseño |
| `lib/publish-contract-min.ts` | `EL_HEAD_YA_EXISTE` vale también para una página vacía |
| `lib/projects/titulo-del-html.ts` | `UNTITLED_PROJECT_TITLE` |
| `lib/projects.ts` | `adoptPlaceholderTitle`, `findOrCreateBlankProject`, `isBlank` en la lista, sin miniatura vacía |
| `lib/projects/blank.ts` (nuevo) | `isBlankProject`: puro, cliente y servidor |
| `lib/projects/chat-photos.ts` (nuevo) | `photosOf`, `photosForRow`, `MAX_PHOTOS_PER_MESSAGE` |
| `lib/agent/tools.ts` | Adopta el título al guardar |
| `app/api/projects/route.ts` | `POST`: el proyecto en blanco |
| `app/api/agent/route.ts` | `attachedImages`, `styleDirection`; después sin `verifyTurn` |
| `lib/style-match/parse-direction.ts` (nuevo) | `parseStyleDirection`, mudado de `app/api/generate/route.ts` |
| `app/[locale]/new/page.tsx` | `/new` abre el proyecto en blanco; la entrada como estado vacío del chat |
| `components/marketing/hero-prompt-input.tsx` | Sin `autostart` |
| Borrados (Tarea 12) | `app/api/generate/`, `lib/use-generation.ts`, `app/api/crear/escritor/`, `lib/generation/subpagina-prompt.ts` |

---

### Task 1: El cliente de Fireworks cede los trozos de argumentos (opcional)

**Files:**
- Modify: `lib/ai/fireworks-stream-client.ts:29-41` (tipo), `:70` (`FireworksStreamRequest`), `:452-463` (bucle de `tool_calls`)
- Test: `lib/ai/fireworks-stream-client.test.ts` (ya en `include`)

**Interfaces:**
- Produces:
  - `FireworksStreamEvent` suma `{ readonly type: "function_call_delta"; readonly index: number; readonly name?: string; readonly argsDelta: string }`.
  - `FireworksStreamRequest` suma `readonly streamToolArgs?: boolean`.
  - Sin la opción, el cable sale **byte a byte igual** que hoy.

- [ ] **Step 1: Escribir las pruebas que fallan** — al final del `describe("transporte de texto en streaming")` de `lib/ai/fireworks-stream-client.test.ts`:

```ts
  it("con streamToolArgs cede los trozos de los argumentos EN VIVO, y la llamada armada sale igual", async () => {
    // Los «live tool deltas» de DeepSeek: el lienzo pinta un Write mientras se
    // escribe. El trozo lleva el nombre de la llamada aunque el proveedor sólo
    // lo mande en el primero.
    const { client: c } = client(
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Write", arguments: '{"file_path":"/index.html",' } }] })
      + chunk({ tool_calls: [{ index: 0, function: { arguments: '"content":"<h1>Hola' } }] })
      + chunk({ tool_calls: [{ index: 0, function: { arguments: '</h1>"}' } }] }, "tool_calls"),
    );
    const events = await drain(c.stream({ ...REQUEST, streamToolArgs: true, tools: [{ type: "function", function: { name: "Write" } }] }));
    expect(events.filter((e) => e.type === "function_call_delta")).toEqual([
      { type: "function_call_delta", index: 0, name: "Write", argsDelta: '{"file_path":"/index.html",' },
      { type: "function_call_delta", index: 0, name: "Write", argsDelta: '"content":"<h1>Hola' },
      { type: "function_call_delta", index: 0, name: "Write", argsDelta: '</h1>"}' },
    ]);
    expect(events.find((e) => e.type === "function_call")).toEqual({
      type: "function_call",
      name: "Write",
      args: { file_path: "/index.html", content: "<h1>Hola</h1>" },
    });
  });

  it("sin streamToolArgs no sale ni un trozo: el cable de siempre", async () => {
    const { client: c } = client(
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Write", arguments: '{"file_path":"/index.html","content":"x"}' } }] }, "tool_calls"),
    );
    const events = await drain(c.stream({ ...REQUEST, tools: [{ type: "function", function: { name: "Write" } }] }));
    expect(events.some((e) => e.type === "function_call_delta")).toBe(false);
  });
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `npx vitest run lib/ai/fireworks-stream-client.test.ts`
Expected: FAIL. La primera no encuentra deltas; la segunda pasa ya (es la red de seguridad).

- [ ] **Step 3: Implementar.** En el tipo `FireworksStreamEvent`, justo antes de la variante `function_call`:

```ts
  // LOS TROZOS DE LOS ARGUMENTOS, en vivo y SÓLO si se piden
  // (`streamToolArgs`): son los «live tool deltas» de DeepSeek, con los que el
  // lienzo pinta un Write mientras se escribe. La llamada armada de abajo sigue
  // saliendo igual: el trozo sólo se enseña, nunca se ejecuta.
  | { readonly type: "function_call_delta"; readonly index: number; readonly name?: string; readonly argsDelta: string }
```

En `FireworksStreamRequest`, añade el campo con su comentario:

```ts
  /** Ceder `function_call_delta` mientras llegan los argumentos. Sin él, el
   *  cable sale como siempre. */
  readonly streamToolArgs?: boolean;
```

En el bucle de `delta.tool_calls`, justo después de `pendingCalls.set(index, {...})`:

```ts
              const trozo = typeof fn?.arguments === "string" ? fn.arguments : "";
              if (request.streamToolArgs && trozo.length > 0) {
                const nombre = pendingCalls.get(index)?.name;
                yield { type: "function_call_delta", index, ...(nombre ? { name: nombre } : {}), argsDelta: trozo };
              }
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `npx vitest run lib/ai/fireworks-stream-client.test.ts`
Expected: PASS (todas, también las de antes).

- [ ] **Step 5: Typecheck.** `npm run typecheck`. Si algún consumidor del tipo tiene un `switch` exhaustivo (`lib/ai/fireworks-as-stream-provider.ts`, `lib/ai-stream/generate.ts`, `lib/style-match/autofill/fill-template.ts`, `app/api/templates/ai-design/route.ts`), añádele `case "function_call_delta": break;` con el comentario «no lo pide: nunca llega».

- [ ] **Step 6: Commit**

```bash
git add lib/ai/fireworks-stream-client.ts lib/ai/fireworks-stream-client.test.ts
git commit -m "sumar(fireworks): los trozos de los argumentos en vivo, opcionales, como los live tool deltas de DeepSeek"
```

---

### Task 2: Leer un `Write` a medias (puro)

**Files:**
- Create: `lib/agent/write-preview.ts`
- Create: `lib/agent/write-preview.test.ts`
- Modify: `vitest.config.ts` (`include`: añadir `"lib/agent/write-preview.test.ts",` junto a `"lib/agent/loop.test.ts"`)

**Interfaces:**
- Consumes: `paginaDeRuta(ruta): { page: string | null } | null` de `lib/agent/ficheros/sitio.ts:62`.
- Produces:
  - `readPartialWrite(argsSoFar: string): { filePath: string | null; content: string | null }`
  - `createWritePreview(step?: number): { push(delta: { index: number; name?: string; argsDelta: string }): PagePreview | null }`
  - `interface PagePreview { readonly page: string | null; readonly html: string }`
  - `PREVIEW_STEP_CHARS = 1_500`

- [ ] **Step 1: Escribir las pruebas que fallan** en `lib/agent/write-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWritePreview, readPartialWrite } from "./write-preview";

describe("readPartialWrite — el Write a medias", () => {
  it("lee la ruta y el contenido de unos argumentos enteros", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<h1>Hola</h1>"}')).toEqual({
      filePath: "/index.html",
      content: "<h1>Hola</h1>",
    });
  });

  it("un contenido cortado se lee hasta donde llegó", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<h1>Ho')).toEqual({
      filePath: "/index.html",
      content: "<h1>Ho",
    });
  });

  it("🔴 una barra sola al final no se pinta: es medio escape", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<p>a\\').content).toBe("<p>a");
  });

  it("🔴 un \\u a medias tampoco; entero, sí", () => {
    expect(readPartialWrite('{"file_path":"/x/index.html","content":"caf\\u00e').content).toBe("caf");
    expect(readPartialWrite('{"file_path":"/x/index.html","content":"caf\\u00e9"}').content).toBe("café");
  });

  it("decodifica comillas, saltos y barras", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<a href=\\"/\\">\\n</a>\\\\"}').content).toBe(
      '<a href="/">\n</a>\\',
    );
  });

  it("si el contenido llega ANTES que la ruta, la ruta es null hasta que llegue", () => {
    expect(readPartialWrite('{"content":"<h1>Hola</h1>","file_pa')).toEqual({ filePath: null, content: "<h1>Hola</h1>" });
  });

  it("una ruta sin cerrar no es una ruta", () => {
    expect(readPartialWrite('{"file_path":"/ind').filePath).toBeNull();
  });

  it("sin contenido todavía: null, no cadena vacía", () => {
    expect(readPartialWrite('{"file_path":"/index.html",').content).toBeNull();
  });
});

describe("createWritePreview — cuándo se pinta", () => {
  const html = (n: number) => "<p>" + "x".repeat(n);

  it("un Write de una página pinta cada `step` caracteres nuevos", () => {
    const p = createWritePreview(10);
    expect(p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/index.html","content":"' })).toBeNull();
    expect(p.push({ index: 0, argsDelta: html(4) })).toBeNull(); // 7 < 10
    expect(p.push({ index: 0, argsDelta: "yyyy" })).toEqual({ page: null, html: html(4) + "yyyy" }); // 11
    expect(p.push({ index: 0, argsDelta: "z" })).toBeNull(); // +1
  });

  it("la página la dice la ruta: /menu/index.html es «menu»", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/menu/index.html","content":"' });
    expect(p.push({ index: 0, argsDelta: "<h1>" })).toEqual({ page: "menu", html: "<h1>" });
  });

  it("🔴 un Write que no es de una página no pinta nada", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/js/app.js","content":"' });
    expect(p.push({ index: 0, argsDelta: "const a = 1;" })).toBeNull();
  });

  it("otra herramienta no pinta aunque traiga `content`", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Edit", argsDelta: '{"file_path":"/index.html","content":"' });
    expect(p.push({ index: 0, argsDelta: "<h1>" })).toBeNull();
  });

  it("dos llamadas en paralelo se leen por su índice", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/index.html","content":"' });
    p.push({ index: 1, name: "Write", argsDelta: '{"file_path":"/menu/index.html","content":"' });
    expect(p.push({ index: 1, argsDelta: "B" })).toEqual({ page: "menu", html: "B" });
    expect(p.push({ index: 0, argsDelta: "A" })).toEqual({ page: null, html: "A" });
  });
});
```

- [ ] **Step 2: Añadir la línea a `include` y ver que fallan**

Run: `npx vitest run lib/agent/write-preview.test.ts`
Expected: FAIL («Failed to resolve import "./write-preview"»).

- [ ] **Step 3: Implementar** `lib/agent/write-preview.ts`:

```ts
/**
 * LA PÁGINA A MEDIAS — los «live tool deltas» de DeepSeek
 * (`packages/client/ui-chat/README.md:96` de deepseek-harness), para el lienzo.
 *
 * El cliente de Fireworks cede los argumentos de cada llamada a trozos
 * (`function_call_delta`). Esto lee de esos trozos la ruta y el contenido de un
 * `Write` ANTES de que la llamada termine, y dice cuándo merece la pena pintar.
 * Sólo se enseña: lo que se guarda sigue siendo la llamada armada, que pasa por
 * las guardas de `Write` como siempre.
 *
 * Puro, sin imports pesados: lo prueba vitest sin binding ni base.
 */
import { paginaDeRuta } from "./ficheros/sitio";

/** Cada cuántos caracteres NUEVOS se repinta. El lienzo es un iframe: pintarlo
 *  a cada trozo (unos pocos caracteres) sería repintar cientos de veces. */
export const PREVIEW_STEP_CHARS = 1_500;

export interface PagePreview {
  readonly page: string | null;
  readonly html: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** El valor de una clave de cadena en un JSON que puede estar cortado.
 *  `complete` dice si llegó la comilla de cierre. Un escape a medias al final
 *  se deja fuera: se completará con el trozo siguiente. */
function readStringField(src: string, key: string): { value: string; complete: boolean } | null {
  // Dentro de una cadena JSON una comilla va escapada (`\"`), así que
  // `"clave":"` sin barra delante sólo puede ser una clave de verdad.
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(src);
  if (!match) return null;
  let i = match.index + match[0].length;
  let value = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '"') return { value, complete: true };
    if (ch !== "\\") {
      value += ch;
      i++;
      continue;
    }
    if (i + 1 >= src.length) break;
    const esc = src[i + 1]!;
    if (esc === "u") {
      const hex = src.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const decoded = ESCAPES[esc];
    if (decoded === undefined) break;
    value += decoded;
    i += 2;
  }
  return { value, complete: false };
}

/** La ruta (sólo si está entera) y el contenido (hasta donde haya llegado). */
export function readPartialWrite(argsSoFar: string): { filePath: string | null; content: string | null } {
  const path = readStringField(argsSoFar, "file_path");
  const content = readStringField(argsSoFar, "content");
  return {
    filePath: path?.complete ? path.value : null,
    content: content ? content.value : null,
  };
}

/** Junta los trozos por llamada y devuelve una vista previa cuando un `Write`
 *  de una PÁGINA lleva `step` caracteres nuevos desde la última. */
export function createWritePreview(step: number = PREVIEW_STEP_CHARS) {
  const calls = new Map<number, { name?: string; args: string; painted: number }>();
  return {
    push(delta: { readonly index: number; readonly name?: string; readonly argsDelta: string }): PagePreview | null {
      const prev = calls.get(delta.index);
      const call = {
        name: delta.name ?? prev?.name,
        args: (prev?.args ?? "") + delta.argsDelta,
        painted: prev?.painted ?? 0,
      };
      calls.set(delta.index, call);
      if (call.name !== "Write") return null;
      const { filePath, content } = readPartialWrite(call.args);
      if (filePath === null || content === null) return null;
      const target = paginaDeRuta(filePath);
      if (!target) return null;
      if (content.length - call.painted < step) return null;
      call.painted = content.length;
      return { page: target.page, html: content };
    },
  };
}
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `npx vitest run lib/agent/write-preview.test.ts`
Expected: PASS (13 pruebas).

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/agent/write-preview.ts lib/agent/write-preview.test.ts
git add lib/agent/write-preview.ts lib/agent/write-preview.test.ts vitest.config.ts
git commit -m "sumar(len): leer un Write a medias para pintar la página mientras se escribe"
```

---

### Task 3: Len reenvía la página a medias y el lienzo la pinta

**Files:**
- Modify: `lib/ai-gateway.ts:132-156` (`StreamEvent`)
- Modify: `lib/agent/brain.ts:229-247` (`viaFireworks`: pedir `streamToolArgs`)
- Modify: `lib/agent/loop.ts:74-200` (`AgentStreamEvent`), `:1503` (bucle del stream)
- Modify: `components/workspace-v2/chat/use-agent-chat.ts:1566` (rama `html`), `:1906` (`finally`)
- Test: `lib/agent/loop.test.ts` (ya en `include`)

**Interfaces:**
- Consumes: `createWritePreview` (Tarea 2) y `function_call_delta` (Tarea 1).
- Produces:
  - `AgentStreamEvent` suma `{ type: "page_preview"; html: string; page: string | null }`.
  - La ruta lo reenvía sin cambios (`emit(ev.type, ev)` en `app/api/agent/route.ts:1630`), y el cliente lo recibe como `event: page_preview`.

- [ ] **Step 1: Escribir la prueba que falla** al final de `lib/agent/loop.test.ts`. Usa los ayudantes que el fichero ya tiene arriba (`scripted`, `done`), y el ejecutor falso con `updatedHtml`, como la prueba de la línea ~192:

```ts
describe("runAgentLoop — la página a medias (plans/crear-es-len)", () => {
  it("un Write de /index.html emite page_preview mientras llegan los trozos, y después el html de siempre", async () => {
    const contenido = "<!doctype html><title>T</title>" + "<p>x</p>".repeat(400); // > 1.500 caracteres
    const args = JSON.stringify({ file_path: "/index.html", content: contenido });
    const mitad = Math.floor(args.length / 2);
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "hazme la página" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call_delta", index: 0, name: "Write", argsDelta: args.slice(0, mitad) },
          { type: "function_call_delta", index: 0, name: "Write", argsDelta: args.slice(mitad) },
          { type: "function_call", name: "Write", args: JSON.parse(args) as Record<string, unknown> },
          done,
        ],
        [{ type: "text_delta", text: "Lista." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: contenido }),
      emit: (e) => events.push(e),
    });
    const tipos = events.map((e) => e.type);
    expect(tipos).toContain("page_preview");
    expect(tipos.indexOf("page_preview")).toBeLessThan(tipos.indexOf("html"));
    expect(events.find((e) => e.type === "page_preview")).toMatchObject({ page: null });
  });

  it("un Write de /js/app.js no emite ninguna vista previa", async () => {
    const args = JSON.stringify({ file_path: "/js/app.js", content: "x".repeat(4000) });
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call_delta", index: 0, name: "Write", argsDelta: args }, { type: "function_call", name: "Write", args: JSON.parse(args) as Record<string, unknown> }, done],
        [{ type: "text_delta", text: "ok" }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "page_preview")).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npx vitest run lib/agent/loop.test.ts -t "la página a medias"`
Expected: FAIL (no hay `page_preview`).

- [ ] **Step 3: El tipo del cable.** En `lib/ai-gateway.ts`, dentro de `StreamEvent`, antes de `function_call`:

```ts
  /** Un trozo de los argumentos de una llamada, en vivo (`streamToolArgs`).
   *  Sólo se ENSEÑA (`lib/agent/write-preview.ts`); se ejecuta la armada. */
  | { type: "function_call_delta"; index: number; name?: string; argsDelta: string }
```

- [ ] **Step 4: El cerebro lo pide.** En `lib/agent/brain.ts`, dentro de `viaFireworks`, en el objeto que se pasa a `fireworks.stream(...)`, junto a `...(withTools ? { tools: wireTools } : {})`:

```ts
          // LOS TROZOS DE LOS ARGUMENTOS, para pintar un Write mientras se
          // escribe. Sólo con herramientas: el cierre (`closeOut`) no tiene.
          ...(withTools ? { streamToolArgs: true } : {}),
```

`asAgentStream` (`brain.ts:86`) ya deja pasar todo lo que no es `reasoning_delta`; no hay que tocarlo.

- [ ] **Step 5: El bucle lo emite.** En `lib/agent/loop.ts`:
  - **Import**: `import { createWritePreview } from "./write-preview";`
  - **`AgentStreamEvent`**: justo antes de la variante `html` (`:172`), añade:

```ts
  // LA PÁGINA A MEDIAS (los «live tool deltas» de DeepSeek): lo que un Write
  // de una página lleva escrito. Sólo se pinta; lo que cuenta es `html`.
  | { type: "page_preview"; html: string; page: string | null }
```

  - **Antes** del `for await (const ev of args.openStream(messages))` de la línea ~1503:

```ts
      // Una por intento: un reintento vuelve a escribir desde cero.
      const writePreview = createWritePreview();
```

  - **Dentro** del `for await`, antes de `} else if (ev.type === "function_call") {`:

```ts
        } else if (ev.type === "function_call_delta") {
          const preview = writePreview.push(ev);
          if (preview) args.emit({ type: "page_preview", html: preview.html, page: preview.page });
```

- [ ] **Step 6: Ejecutar la prueba del bucle**

Run: `npx vitest run lib/agent/loop.test.ts`
Expected: PASS, incluidas las demás.

- [ ] **Step 7: El cliente pinta y restaura.** En `components/workspace-v2/chat/use-agent-chat.ts`, dentro de la rama de Len de `send`:
  - Junto a la declaración de `latestAgentHtml` (`grep -n "let latestAgentHtml" components/workspace-v2/chat/use-agent-chat.ts`):

```ts
          // ¿Hay en el lienzo una página A MEDIAS de este turno? Si el turno
          // acaba sin su `html` (una guarda rechazó el Write, se cortó, se
          // canceló), se devuelve el documento de antes: medio HTML pintado no
          // es la página de nadie.
          let previewPainted = false;
```

  - Antes de `} else if (evName === "html") {` (`:1566`):

```ts
              } else if (evName === "page_preview") {
                // Sólo la página que el dueño tiene delante, y marcada como no
                // confiable, como el goteo del chat viejo (`html_chunk`).
                const html = strField(payload, "html");
                const evPage =
                  payload && typeof payload === "object" && typeof (payload as { page?: unknown }).page === "string"
                    ? (payload as { page: string }).page
                    : null;
                if (html && evPage === turnPage) {
                  previewPainted = true;
                  onLocalUpdate(html, evPage, true);
                }
```

  - Dentro de la rama `html`, después de calcular `evPage`: `if (evPage === turnPage) previewPainted = false;`
  - En el `finally` de esa rama (`:1906`), como **primera** línea:

```ts
          if (previewPainted) onLocalUpdate(preEditHtml, turnPage);
```

- [ ] **Step 8: Typecheck y lint.** Corre `npm run typecheck` y después `npx eslint lib/ai-gateway.ts lib/agent/brain.ts lib/agent/loop.ts components/workspace-v2/chat/use-agent-chat.ts`.

- [ ] **Step 9: Verificar en el navegador** (build de producción en 127.0.0.1, base local; ver Global Constraints). En un proyecto existente, pide a Len «reescribe la portada entera».
  - **Esperado**: el lienzo se va llenando antes de que termine el turno, y al final queda la página guardada.
  - **Después**, provoca un fallo (cancela a mitad con ■): el lienzo **vuelve** a la página de antes.
  - Guarda capturas de los dos casos.

- [ ] **Step 10: Commit**

```bash
git add lib/ai-gateway.ts lib/agent/brain.ts lib/agent/loop.ts lib/agent/loop.test.ts components/workspace-v2/chat/use-agent-chat.ts
git commit -m "sumar(len): la página se ve formarse mientras Len la escribe, y vuelve atrás si el turno no la guarda"
```

---

### Task 4: Lo que sabía Crear, dentro de la guía de diseño

**Files:**
- Modify: `lib/agent/manual-de-la-plataforma.ts:163-166` (`INDICE`), `:184-214` (`partirElManual`)
- Modify: `lib/publish-contract-min.ts:346-351` (`EL_HEAD_YA_EXISTE`)
- Test: `lib/agent/manual-de-la-plataforma.test.ts` (ya en `include`), `lib/prompts-golden.test.ts`

**Interfaces:**
- Produces: `/.openlen/docs/guia-de-diseno.md` empieza, tras su cabecera, con el bloque `WHEN THE PAGE IS EMPTY`.

- [ ] **Step 1: Escribir la prueba que falla** en `lib/agent/manual-de-la-plataforma.test.ts` (sus imports ya traen `documentosDeLaPlataforma`, `buildManualDeLaPlataforma` y `RUTA_GUIA`; si no, añádelos):

```ts
describe("crear desde cero vive en la guía de diseño (plans/crear-es-len)", () => {
  it("la guía trae lo que sabía Crear: la forma no viene dada, el <title> y el <head> enteros", () => {
    const guia = documentosDeLaPlataforma()[RUTA_GUIA]!;
    expect(guia).toContain("WHEN THE PAGE IS EMPTY");
    expect(guia).toContain("There is no default shape.");
    expect(guia).toContain("a descriptive <title> that names the product");
  });

  it("/AGENTS.md no lo carga en cada vuelta: sólo dice cuándo leerlo", () => {
    const agents = buildManualDeLaPlataforma({});
    expect(agents).not.toContain("There is no default shape.");
    expect(agents).toContain("an empty /index.html is one");
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npx vitest run lib/agent/manual-de-la-plataforma.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** En `lib/agent/manual-de-la-plataforma.ts`, encima de `const INDICE`:

```ts
// LO QUE SABÍA CREAR (plans/crear-es-len, 2026-10-06). Crear dejó de ser una
// superficie aparte y pasó a ser el primer mensaje a Len; esto es lo que sólo
// decía su prompt (`app/api/generate/system-prompt.ts`), mudado sin reescribir
// a la guía que el índice ya manda leer antes de escribir desde cero. El resto
// de aquel prompt —contrato, librerías, JavaScript— Len ya lo tenía.
const FROM_SCRATCH = `WHEN THE PAGE IS EMPTY (you are writing it from scratch):
- The brief is sometimes specific, often vague. Design the whole page yourself: the structure, the palette, the typography, the rhythm and what the page even contains are yours to decide — a vague brief is your cue to apply judgment, not to fall back on something safe.
- There is no default shape. Nav on top, centered hero, three columns of benefits, testimonials, closing call and footer is ONE shape, not THE shape: it is the one that comes out by itself when nobody decides. Let the shape grow out of the content. Something to be read wants a column; something to be looked at wants a grid; something that happens over time wants a line; something to be compared wants a table; something with a single idea can fit in two blocks and be finished.
- Three habits to CHOOSE, not inherit: splitting the content into cards in threes, always opening with the same centered hero, and adding a section because one seems to be missing. Keep them when this page asks for them —a long text is glad of its table of contents, a shop is glad of its navigation— and leave them out when it doesn't.
- Write the whole document with Write, <head> included: a descriptive <title> that names the product, Tailwind via CDN, the Google Fonts you use and your own <style>.
- Every other page of the site is one more file, /<slug>/index.html, written the same way.`;
```

  En `INDICE`, cambia `read it BEFORE writing a page from scratch or a redesign.` por:

```ts
read it BEFORE writing a page from scratch (an empty /index.html is one) or a redesign.
```

  En `partirElManual`, cambia la entrada de la guía:

```ts
      [RUTA_GUIA]: `${cabecera}\n\n${FROM_SCRATCH}\n\n${gusto}`,
```

  En `lib/publish-contract-min.ts:350-351`, cambia la última frase de `EL_HEAD_YA_EXISTE`:

```ts
  "in a `<style>`. When the document already has them, add what you are missing INSIDE them " +
  "—a new family, new rules— instead of duplicating them; a page you write from scratch gets all three.";
```

- [ ] **Step 4: Ejecutar** las dos suites

Run: `npx vitest run lib/agent/manual-de-la-plataforma.test.ts lib/prompts-golden.test.ts`
Expected:
- `manual-de-la-plataforma`: PASS.
- `prompts-golden`: FAIL sólo por el texto nuevo. **Lee el diff entero**: tiene que contener sólo `FROM_SCRATCH`, la línea del índice y la frase del `<head>`. Si es así, actualízalo con `npx vitest run lib/prompts-golden.test.ts -u` y vuelve a correrlo (PASS). Si cambia cualquier otra cosa, para y averigua por qué.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/manual-de-la-plataforma.ts lib/agent/manual-de-la-plataforma.test.ts lib/publish-contract-min.ts lib/prompts-golden.test.ts lib/__snapshots__
git commit -m "mudar(len): lo que sólo sabía Crear, a la guía que Len lee antes de escribir desde cero"
```

(Comprueba la ruta real de los snapshots con `git status` antes de `git add`.)

---

### Task 5: El título de relleno se adopta del `<title>`

**Files:**
- Modify: `lib/projects/titulo-del-html.ts` (constante)
- Modify: `lib/projects.ts:286-318` (`createProject` usa la constante), y una función nueva `adoptPlaceholderTitle`
- Modify: `lib/agent/tools.ts:527-532` (`saveProjectData`)
- Test: `lib/projects/blank-project.pg.test.ts` (nuevo; se comparte con la Tarea 6) + su línea en `include`

**Interfaces:**
- Produces:
  - `UNTITLED_PROJECT_TITLE = "Untitled page"` (en `lib/projects/titulo-del-html.ts`).
  - `adoptPlaceholderTitle(projectId: string, userId: string, homeHtml: string): Promise<void>`: no lanza.

- [ ] **Step 1: Escribir la prueba que falla** en `lib/projects/blank-project.pg.test.ts`:

```ts
// @vitest-environment node
// El proyecto en blanco y su título, contra la base LOCAL (plans/crear-es-len).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { adoptPlaceholderTitle, createProject, renameProject } from "@/lib/projects";
import { UNTITLED_PROJECT_TITLE } from "@/lib/projects/titulo-del-html";

const USER = "prueba-crear-es-len-user";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
});

const titleOf = async (id: string) =>
  (await db.select({ t: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, id)))[0]!.t;

describe("el título de un proyecto que nace en blanco", () => {
  it("nace con el de relleno y adopta el <title> de la portada", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    expect(await titleOf(id)).toBe(UNTITLED_PROJECT_TITLE);
    await adoptPlaceholderTitle(id, USER, "<html><head><title>Taquería Lupita</title></head></html>");
    expect(await titleOf(id)).toBe("Taquería Lupita");
  });

  it("🔴 un nombre puesto a mano NO se pisa", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    await renameProject(id, USER, "Mi negocio");
    await adoptPlaceholderTitle(id, USER, "<title>Otra cosa</title>");
    expect(await titleOf(id)).toBe("Mi negocio");
  });

  it("sin <title> no cambia nada", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    await adoptPlaceholderTitle(id, USER, "<h1>Hola</h1>");
    expect(await titleOf(id)).toBe(UNTITLED_PROJECT_TITLE);
  });
});
```

(`renameProject(projectId, userId, title)`, `lib/projects.ts:498`.)

- [ ] **Step 2: Añadir `"lib/projects/blank-project.pg.test.ts",` a `include` y ver que falla**

Run: `DATABASE_URL=<la de 5546> npx vitest run lib/projects/blank-project.pg.test.ts`
Expected: FAIL (`adoptPlaceholderTitle` no existe).

- [ ] **Step 3: Implementar.** En `lib/projects/titulo-del-html.ts`:

```ts
/** El nombre de un proyecto que todavía no tiene `<title>`. Un proyecto en
 *  blanco nace con él, y lo deja en cuanto Len guarda una portada con título. */
export const UNTITLED_PROJECT_TITLE = "Untitled page";
```

  En `lib/projects.ts`:
  - Importa la constante junto a `titleFromHtml`.
  - Sustituye el literal `"Untitled page"` de `createProject` por `UNTITLED_PROJECT_TITLE`.
  - Añade debajo de `createProject`:

```ts
/**
 * EL TÍTULO DEL PROYECTO, del `<title>` de su portada — lo que Crear hacía al
 * guardar (`createProject` → `titleFromHtml`) y `persistPage` no hace nunca.
 * Sólo pisa el de RELLENO: el `WHERE` lo garantiza en la misma sentencia, así
 * que un nombre que el dueño haya puesto no se toca ni en una carrera.
 * No lanza: un título es un detalle, no puede tumbar un guardado.
 */
export async function adoptPlaceholderTitle(projectId: string, userId: string, homeHtml: string): Promise<void> {
  const title = titleFromHtml(homeHtml);
  if (!title) return;
  try {
    await db
      .update(schema.projects)
      .set({ title })
      .where(
        and(
          eq(schema.projects.id, projectId),
          eq(schema.projects.userId, userId),
          eq(schema.projects.title, UNTITLED_PROJECT_TITLE),
        ),
      );
  } catch (err) {
    console.warn("[projects] no se pudo adoptar el título", err);
  }
}
```

  (Asegúrate de que `and` y `eq` están importados de `drizzle-orm` en `lib/projects.ts`.)

  En `lib/agent/tools.ts`, dentro de `saveProjectData` (`:527`), después del `if (!r.ok) {...}`:

```ts
      // EL TÍTULO DEL PROYECTO EN BLANCO (plans/crear-es-len): en cuanto la
      // portada tiene `<title>`, el de relleno se va. Sin `await`: no retrasa
      // el turno, y la función no lanza.
      void adoptPlaceholderTitle(projectId, userId, r.data.html ?? "");
```

  (Import: `import { adoptPlaceholderTitle } from "@/lib/projects";`, si `tools.ts` no lo trae ya de ahí.)

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `DATABASE_URL=<la de 5546> npx vitest run lib/projects/blank-project.pg.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/projects.ts lib/projects/titulo-del-html.ts lib/agent/tools.ts lib/projects/blank-project.pg.test.ts
git add lib/projects.ts lib/projects/titulo-del-html.ts lib/agent/tools.ts lib/projects/blank-project.pg.test.ts vitest.config.ts
git commit -m "sumar(proyectos): el título de relleno se adopta del <title> de la portada, sin pisar uno puesto a mano"
```

---

### Task 6: El proyecto en blanco (servidor)

**Files:**
- Create: `lib/projects/blank.ts`, `lib/projects/blank.test.ts` (+ `include`)
- Modify: `lib/projects.ts` (`findOrCreateBlankProject`, `isBlank` en `listProjects`, miniatura sólo con HTML)
- Modify: `lib/projects/types.ts` (`ProjectSummary.isBlank`)
- Modify: `app/api/projects/route.ts` (`POST`)
- Test: `lib/projects/blank-project.pg.test.ts` (de la Tarea 5)

**Interfaces:**
- Produces:
  - `isBlankProject(p: { html: string | null | undefined; pages: Readonly<Record<string, unknown>> | null | undefined; chatTurns: number }): boolean`
  - `findOrCreateBlankProject(userId: string): Promise<string>`
  - `ProjectSummary.isBlank: boolean`
  - `POST /api/projects` → `200 { id: string }`; `401` sin sesión.

- [ ] **Step 1: Escribir las pruebas que fallan.** En `lib/projects/blank.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBlankProject } from "./blank";

describe("isBlankProject — como la «New Session» de DeepSeek", () => {
  it("sin portada, sin páginas y sin conversación: en blanco", () => {
    expect(isBlankProject({ html: "", pages: {}, chatTurns: 0 })).toBe(true);
    expect(isBlankProject({ html: null, pages: undefined, chatTurns: 0 })).toBe(true);
    expect(isBlankProject({ html: "  \n", pages: null, chatTurns: 0 })).toBe(true);
  });
  it("🔴 con conversación NO está en blanco aunque no haya HTML: es del usuario", () => {
    expect(isBlankProject({ html: "", pages: {}, chatTurns: 1 })).toBe(false);
  });
  it("con portada o con una página, no", () => {
    expect(isBlankProject({ html: "<h1>Hola</h1>", pages: {}, chatTurns: 0 })).toBe(false);
    expect(isBlankProject({ html: "", pages: { menu: { html: "x" } }, chatTurns: 0 })).toBe(false);
  });
});
```

  Y en `lib/projects/blank-project.pg.test.ts`, añade:

```ts
import { findOrCreateBlankProject, listProjects } from "@/lib/projects";
import { abrirFilaDelTurno } from "@/lib/projects/chat";

describe("findOrCreateBlankProject", () => {
  it("reutiliza el blanco que hay en vez de crear otro", async () => {
    const a = await findOrCreateBlankProject(USER);
    const b = await findOrCreateBlankProject(USER);
    expect(b).toBe(a);
  });

  it("🔴 uno con conversación ya no cuenta: se crea otro", async () => {
    const a = await findOrCreateBlankProject(USER);
    // La fila que la ruta de Len abre al empezar un turno (lib/projects/chat.ts:350).
    await abrirFilaDelTurno(a, { id: `t-${a}`, userText: "hola", page: null });
    const b = await findOrCreateBlankProject(USER);
    expect(b).not.toBe(a);
  });

  it("la lista marca los blancos", async () => {
    const id = await findOrCreateBlankProject(USER);
    const fila = (await listProjects(USER)).find((p) => p.id === id)!;
    expect(fila.isBlank).toBe(true);
  });
});
```

- [ ] **Step 2: Añadir `"lib/projects/blank.test.ts",` a `include` y ver que fallan**

Run: `npx vitest run lib/projects/blank.test.ts` y `DATABASE_URL=<la de 5546> npx vitest run lib/projects/blank-project.pg.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `lib/projects/blank.ts`:

```ts
/**
 * EL PROYECTO EN BLANCO — la «New Session» de DeepSeek
 * (`packages/client/ui-workspace/README.md:30,76,78` de deepseek-harness):
 * existe antes del primer mensaje, se reutiliza en vez de crear otro, y lo que
 * está en blanco no sale en la lista salvo el que tienes abierto.
 *
 * En blanco = sin portada, sin páginas y sin conversación. Con conversación ya
 * no lo es aunque Len no llegara a escribir: lo que el usuario dijo es suyo.
 *
 * Puro: lo usan el servidor (la lista, `findOrCreateBlankProject`) y el cliente
 * (`/new` decide si pinta el estado vacío).
 */
export function isBlankProject(p: {
  readonly html: string | null | undefined;
  readonly pages: Readonly<Record<string, unknown>> | null | undefined;
  readonly chatTurns: number;
}): boolean {
  return !(p.html ?? "").trim() && Object.keys(p.pages ?? {}).length === 0 && p.chatTurns === 0;
}
```

  En `lib/projects.ts`:
  - En `createProject`, la miniatura sólo con HTML: `if (input.html.trim()) void renderProjectThumbnail({ projectId: id, html: input.html });` (con su comentario: «una página vacía no tiene miniatura que pintar»).
  - Añade `findOrCreateBlankProject`:

```ts
/**
 * EL PROYECTO EN BLANCO del usuario, o uno nuevo si no tiene — como «New
 * Session» de DeepSeek, que toma el primer blanco que hay antes de crear otro.
 * Dos pestañas a la vez pueden crear dos: no rompe nada, el sobrante no sale
 * en la lista y se reutilizará la próxima vez.
 */
export async function findOrCreateBlankProject(userId: string): Promise<string> {
  const p = schema.projects;
  const [existing] = await db
    .select({ id: p.id })
    .from(p)
    .where(
      and(
        eq(p.userId, userId),
        sql`coalesce(btrim(${p.data}->>'html'), '') = ''`,
        sql`coalesce(${p.data}->'pages', '{}'::jsonb) = '{}'::jsonb`,
        sql`not exists (select 1 from ${schema.projectChatMessages} m where m."projectId" = ${p.id})`,
      ),
    )
    .orderBy(desc(p.updatedAt))
    .limit(1);
  if (existing) return existing.id;
  return createProject(userId, { brief: "", html: "" });
}
```

  - En `listProjects`, añade al `select`:

```ts
      chatTurns: sql<number>`(select count(*)::int from ${schema.projectChatMessages} m where m."projectId" = ${schema.projects.id})`,
```

    y en el `map`:

```ts
      isBlank: isBlankProject({ html: row.data?.html, pages: row.data?.pages, chatTurns: row.chatTurns }),
```

  - En `lib/projects/types.ts`, añade a `ProjectSummary`:

```ts
  /** Sin portada, sin páginas y sin conversación (`lib/projects/blank.ts`). */
  isBlank: boolean;
```

  En `app/api/projects/route.ts`, añade después del `GET`:

```ts
// POST /api/projects — EL PROYECTO EN BLANCO (plans/crear-es-len): el que ya
// tenía el usuario o uno nuevo. Es lo que abre `/new`, como la «New Session»
// de DeepSeek: el proyecto existe antes del primer mensaje.
export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const id = await findOrCreateBlankProject(userId);
  return json({ id }, 200);
});
```

  (Import: `findOrCreateBlankProject` desde `@/lib/projects`.)

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `npx vitest run lib/projects/blank.test.ts` y `DATABASE_URL=<la de 5546> npx vitest run lib/projects/blank-project.pg.test.ts`
Expected: PASS.

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/projects.ts lib/projects/blank.ts lib/projects/types.ts app/api/projects/route.ts
git add lib/projects.ts lib/projects/blank.ts lib/projects/blank.test.ts lib/projects/types.ts lib/projects/blank-project.pg.test.ts app/api/projects/route.ts vitest.config.ts
git commit -m "sumar(proyectos): el proyecto en blanco, reutilizable, como la New Session de DeepSeek"
```

---

### Task 7: Hasta cuatro fotos por mensaje

**Files:**
- Create: `lib/projects/chat-photos.ts`, `lib/projects/chat-photos.test.ts` (+ `include`)
- Modify: `lib/db/schema.ts:349` (tipo de `attachedImage`)
- Modify: `app/api/agent/route.ts:556-580` (parseo), `:612-618` (`masNuevaPrimero`), `:758`, `:821`, `:1139`
- Modify: los lectores que señale `npm run typecheck`: `lib/projects/chat.ts`, `lib/agent/transcripcion.ts:249-250`, `lib/agent/prueba-js.ts`, `lib/agent/terminal/historial.ts`
- Modify: `components/workspace-v2/chat/use-agent-chat.ts` (`send` acepta `opciones.images`; `DesignTurn.attachedImages`) y la burbuja que pinta `attachedImage` (`grep -rn "attachedImage" components/workspace-v2/chat/*.tsx`)

**Interfaces:**
- Produces:
  - `interface ChatPhoto { readonly url: string; readonly alt?: string }`, `MAX_PHOTOS_PER_MESSAGE = 4`
  - `photosOf(v: ChatPhoto | readonly ChatPhoto[] | null | undefined): ChatPhoto[]`
  - `photosForRow(photos: readonly ChatPhoto[]): ChatPhoto | ChatPhoto[] | null`: una foto se guarda como objeto, igual que hoy.
  - Cuerpo de `/api/agent`: `attachedImages?: { url: string; alt?: string }[]` (se lee también `attachedImage`).
  - `send(rawPrompt, imageOverride?, opciones?: { …; images?: readonly AttachedImage[]; styleDirection?: StyleDirection | null })`: `styleDirection` lo usa la Tarea 8.

- [ ] **Step 1: Escribir las pruebas que fallan** (`lib/projects/chat-photos.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { MAX_PHOTOS_PER_MESSAGE, photosForRow, photosOf } from "./chat-photos";

describe("las fotos de un mensaje", () => {
  it("lee filas viejas (un objeto) y nuevas (una lista)", () => {
    expect(photosOf(null)).toEqual([]);
    expect(photosOf({ url: "u1" })).toEqual([{ url: "u1" }]);
    expect(photosOf([{ url: "u1" }, { url: "u2", alt: "b" }])).toEqual([{ url: "u1" }, { url: "u2", alt: "b" }]);
  });
  it("🔴 una sola foto se guarda como siempre (objeto): las filas de un turno con una foto no cambian", () => {
    expect(photosForRow([{ url: "u1" }])).toEqual({ url: "u1" });
    expect(photosForRow([])).toBeNull();
    expect(photosForRow([{ url: "u1" }, { url: "u2" }])).toEqual([{ url: "u1" }, { url: "u2" }]);
  });
  it("el tope es el de Crear", () => {
    expect(MAX_PHOTOS_PER_MESSAGE).toBe(4);
  });
});
```

- [ ] **Step 2: Añadir a `include`, ejecutar y ver que falla**

Run: `npx vitest run lib/projects/chat-photos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el módulo** `lib/projects/chat-photos.ts`:

```ts
/**
 * LAS FOTOS DE UN MENSAJE — varias, como los adjuntos de DeepSeek, y con el
 * tope que tenía Crear (`MAX_REFERENCIAS`, lib/ai/referencia-adjunta.ts).
 *
 * La columna `projectChatMessages.attachedImage` es JSONB: guarda un objeto
 * (todas las filas de antes, y las de una sola foto) o una lista (dos o más).
 * Sin migración; quien lee pasa siempre por `photosOf`.
 */
export interface ChatPhoto {
  readonly url: string;
  readonly alt?: string;
}

export const MAX_PHOTOS_PER_MESSAGE = 4;

export function photosOf(v: ChatPhoto | readonly ChatPhoto[] | null | undefined): ChatPhoto[] {
  if (!v) return [];
  return Array.isArray(v) ? [...v] : [v as ChatPhoto];
}

export function photosForRow(photos: readonly ChatPhoto[]): ChatPhoto | ChatPhoto[] | null {
  if (photos.length === 0) return null;
  return photos.length === 1 ? photos[0]! : [...photos];
}
```

- [ ] **Step 4: Ejecutar** `npx vitest run lib/projects/chat-photos.test.ts`. Expected: PASS.

- [ ] **Step 5: El tipo de la columna.** En `lib/db/schema.ts`, `attachedImage: jsonb("attachedImage").$type<ChatPhoto | ChatPhoto[]>()` (importa el tipo con `import type`). Corre `npm run typecheck`: **la lista de errores es la lista de lectores**. Arregla cada uno con `photosOf(...)`:
  - **`lib/agent/transcripcion.ts:249-250`**: el mensaje del usuario lleva `images` con todas las fotos que se consiguieron:

```ts
  const urls = photosOf(f.attachedImage).map((p) => p.url);
  if (urls.length === 0) return { role: "user", content: f.userText, opensTurn: true };
  const imagenes = urls.map((u) => fotos.get(u) ?? null).filter((x): x is NonNullable<typeof x> => x !== null && x !== NO_CABE);
```

    Adapta esto a lo que la función hace hoy con `foto`; lee la función entera antes de tocarla, sobre todo la nota de «foto que no llega».
  - **`lib/projects/chat.ts`**: el turno del cliente lleva `attachedImage` (la primera, para lo que ya existe) y `attachedImages` (todas).
  - **`app/api/agent/route.ts`**:
    - `masNuevaPrimero` toma `attachedImages.map(p => p.url)` en vez de `attachedImage?.url`, y de cada fila del historial, `photosOf(f.attachedImage)`.
    - `abrirFilaDelTurno(..., attachedImage: photosForRow(attachedImages))`.
    - En la línea 821, `images: attachedInlines` (todas las que llegaron).
  - **`lib/agent/prueba-js.ts`, `lib/agent/terminal/historial.ts`**: lo que diga el typecheck, con `photosOf`.

- [ ] **Step 6: El cuerpo de la petición.** En `app/api/agent/route.ts:556-580`, sustituye el bloque de `attachedImage` por uno que lea los dos campos con la misma validación:

```ts
  // LAS FOTOS DEL MENSAJE: `attachedImages` (hasta 4, como Crear) y el
  // `attachedImage` de siempre, que sigue llegando del chat. Misma validación
  // de antes para cada una; una inválida se descarta en silencio.
  const leerFoto = (raw: unknown): ChatPhoto | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as { url?: unknown; alt?: unknown };
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (url.length === 0 || url.length > ATTACHED_URL_MAX) return null;
    try {
      const parsed = new URL(url, req.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const alt = typeof r.alt === "string" ? r.alt.trim().slice(0, ATTACHED_ALT_MAX) : "";
      return alt ? { url: parsed.href, alt } : { url: parsed.href };
    } catch {
      return null;
    }
  };
  const attachedImages: ChatPhoto[] = [
    ...(Array.isArray(body?.attachedImages) ? body.attachedImages : []),
    ...(body?.attachedImage ? [body.attachedImage] : []),
  ]
    .map(leerFoto)
    .filter((p): p is ChatPhoto => p !== null)
    .slice(0, MAX_PHOTOS_PER_MESSAGE);
```

  Después sustituye cada uso de `attachedImage` en la ruta por `attachedImages` (el typecheck los señala).

- [ ] **Step 7: El cliente.** En `use-agent-chat.ts`:
  - Añade `readonly images?: readonly AttachedImage[]` a `opciones` de `send`.
  - Calcula `const imgs = opciones?.images ?? (img ? [img] : []);`.
  - Manda `attachedImages: imgs` en el cuerpo en lugar de `attachedImage`, y guarda `attachedImages: imgs` en `newTurn`.
  - Añade `attachedImages?: readonly AttachedImage[]` a `DesignTurn`.
  - En la burbuja, pinta `turn.attachedImages ?? (turn.attachedImage ? [turn.attachedImage] : [])`.

- [ ] **Step 8: Pruebas tocadas y puertas**

Run: `npx vitest run lib/projects/chat-photos.test.ts app/api/agent/route.test.ts lib/agent/transcripcion.test.ts` (sólo las que existan; compruébalo con `ls`), después `npm run typecheck` y `npx eslint` sobre los ficheros tocados.
Expected: PASS. Si `route.test.ts` comprobaba `attachedImage` en el cuerpo de `abrirFilaDelTurno`, una foto sigue siendo un objeto: no debería cambiar.

- [ ] **Step 9: Commit**

```bash
git add lib/projects/chat-photos.ts lib/projects/chat-photos.test.ts lib/db/schema.ts lib/projects/chat.ts lib/agent/transcripcion.ts lib/agent/prueba-js.ts lib/agent/terminal/historial.ts app/api/agent/route.ts components/workspace-v2/chat vitest.config.ts
git commit -m "sumar(len): hasta cuatro fotos por mensaje, como los adjuntos de DeepSeek y el tope de Crear"
```

---

### Task 8: La referencia por URL viaja con el mensaje

**Files:**
- Create: `lib/style-match/parse-direction.ts`, `lib/style-match/parse-direction.test.ts` (+ `include`, junto a `"lib/style-match/direction.test.ts"`)
- Modify: `app/api/generate/route.ts:102-~140` (importa la función mudada en vez de definirla)
- Modify: `app/api/agent/route.ts:821` (el bloque delante del mensaje del modelo)
- Modify: `components/workspace-v2/chat/use-agent-chat.ts` (`opciones.styleDirection` → cuerpo)

**Interfaces:**
- Consumes: `directionToBriefBlock(d: StyleDirection): string` (`lib/style-match/direction.ts:69`) y `StyleDirection` (`lib/style-match/direction-types.ts`).
- Produces: `parseStyleDirection(body: unknown): StyleDirection | null`, idéntica a la de hoy, y el campo `styleDirection` en el cuerpo de `/api/agent`.

- [ ] **Step 1: Mudar sin cambiar.** Mueve `parseStyleDirection` tal cual (cuerpo y comentario) de `app/api/generate/route.ts` a `lib/style-match/parse-direction.ts`, exportada. En `generate/route.ts`, impórtala (Crear sigue funcionando hasta la Tarea 12).

- [ ] **Step 2: La prueba** (`lib/style-match/parse-direction.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { parseStyleDirection } from "./parse-direction";

describe("parseStyleDirection — campo a campo, nada de confiar en la forma", () => {
  it("sin paleta válida no hay dirección", () => {
    expect(parseStyleDirection({})).toBeNull();
    expect(parseStyleDirection({ styleDirection: { palette: [{ role: "bg", hex: "rojo" }] } })).toBeNull();
  });
  it("recorta la paleta a 6 y los roles a 24", () => {
    const palette = Array.from({ length: 9 }, (_, i) => ({ role: "r".repeat(40), hex: `#00000${i}` }));
    const d = parseStyleDirection({ styleDirection: { hostname: "x.com", palette, polarity: "light", fontFamily: "Inter", radius: "soft" } });
    expect(d?.palette).toHaveLength(6);
    expect(d?.palette[0]!.role).toHaveLength(24);
  });
});
```

  Antes de fijar la segunda prueba, lee la función mudada: si exige otros campos para no devolver `null`, completa el objeto de la prueba con ellos.

Run: `npx vitest run lib/style-match/parse-direction.test.ts`. Expected: PASS (es una mudanza).

- [ ] **Step 3: La ruta de Len.** En `app/api/agent/route.ts`, junto a la línea 821 (la de las fotos pegadas al mensaje):

```ts
  // LA REFERENCIA POR URL (plans/crear-es-len): el mismo bloque que Crear
  // ponía delante del brief, delante del mensaje de ESTE turno. Sólo para el
  // modelo: la fila guarda lo que el dueño escribió (`prompt`), no el bloque.
  const styleDirection = parseStyleDirection(body);
  if (styleDirection) {
    const ultimo = messages[messages.length - 1]!;
    messages[messages.length - 1] = { ...ultimo, content: `${directionToBriefBlock(styleDirection)}\n\n${ultimo.content}` };
  }
```

  Comprueba que `content` de `Message` es `string` (`lib/ai-gateway.ts`). Si es otra cosa, adapta la concatenación a su forma.

- [ ] **Step 4: El cliente.** En `send`, añade `readonly styleDirection?: StyleDirection | null` a `opciones`, y en el cuerpo del `fetch("/api/agent")`, `...(opciones?.styleDirection ? { styleDirection: opciones.styleDirection } : {})`.

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/style-match/parse-direction.ts app/api/generate/route.ts app/api/agent/route.ts components/workspace-v2/chat/use-agent-chat.ts
git add lib/style-match/parse-direction.ts lib/style-match/parse-direction.test.ts app/api/generate/route.ts app/api/agent/route.ts components/workspace-v2/chat/use-agent-chat.ts vitest.config.ts
git commit -m "sumar(len): la referencia por URL viaja con el mensaje, el mismo bloque que usaba Crear"
```

---

### Task 9: `/new` abre el proyecto en blanco y la entrada es el estado vacío del chat

**Files:**
- Modify: `app/[locale]/new/page.tsx`: `:333-368` (modo de entrada), `:772-945` (brief, `autostart`, `startAiGeneration`), `:3365` (`onFlatHtmlUpdate`), `:3412` (`pendingDraft`), `:3641` (`<StartLanding>`), `:3680` (`PreviewArea`)
- Modify: `components/workspace-v2/chat/use-agent-chat.ts:236-258`, `:1983` (el borrador pendiente lleva fotos y referencia)
- Modify: `components/workspace-v2/chat/new-chat-panel.tsx:46-47`, `:105` (pasar las props nuevas)
- Modify: `components/marketing/hero-prompt-input.tsx:135` (sin `autostart`)
- Modify: la lista de proyectos (`ProjectsSection` y `app/[locale]/projects/`): ocultar `isBlank` salvo el abierto

**Interfaces:**
- Consumes:
  - `POST /api/projects` → `{ id }` (Tarea 6)
  - `isBlankProject` (Tarea 6)
  - `send(..., { images, styleDirection })` (Tareas 7 y 8)
- Produces: la prop nueva `pendingAttachments?: { images: readonly AttachedImage[]; styleDirection: StyleDirection | null } | null` en `useAgentChat` y `NewChatPanel`, que viaja con `pendingDraft`.

- [ ] **Step 1: `/new` sin parámetros abre el blanco.** En `page.tsx`, un efecto: si no hay `project`, ni `mode`, ni `view`, hace `POST /api/projects` y `router.replace("/new?project=<id>" + (brief ? "&brief=..." : ""))`, conservando `brief` si venía.
  - Mientras tanto se pinta lo que hoy se pinta al cargar un proyecto.
  - Si el `POST` falla, se muestra el fallo de carga que ya existe (`setProjectLoadFailure`).
  - Sin sesión (`401`): lo que ya haga `/new` sin sesión (no cambia).

- [ ] **Step 2: El estado vacío.** En la rama `entryMode === "editing"`, antes de `PreviewArea`, calcula:

```ts
  // EL ESTADO VACÍO DEL CHAT DE LEN (plans/crear-es-len): un proyecto en blanco
  // no tiene lienzo que enseñar todavía. Como el «Session Intent hero» de
  // DeepSeek, el centro es el compositor, y enviar es el primer mensaje.
  const proyectoEnBlanco =
    !!loadedProject &&
    !heroSent &&
    isBlankProject({ html: loadedProject.html, pages: loadedProject.pages, chatTurns: loadedProject.chatHistory.length });
```

  - Con `proyectoEnBlanco`, el centro pinta `<StartLanding>` con los mismos props que hoy, pero `onGenerate={handleHeroSend}`, y la barra lateral va plegada (como hoy en el modo `ai`).
  - Sin él, se pinta `PreviewArea`. Cambia su condición `loadedProject && activeDoc` por `loadedProject && (activeDoc || heroSent || loadedProject.chatHistory.length > 0)`, para que el lienzo aparezca **vacío** y se vaya llenando con la vista previa (Tarea 3).

- [ ] **Step 3: Enviar desde la entrada.** Sustituye `startAiGeneration` por `handleHeroSend`:
  1. Valida el brief con el límite de Len (`MAX_PROMPT` de `lib/workspace-v2/comentarios-de-lineas.ts`).
  2. Sube cada foto (`aiFotos`, o las `tomarReferenciasEnTransito()` de la portada) a `POST /api/upload`, igual que el inspector (`components/workspace-v2/panels/properties-panel.tsx:2247`: `FormData` con el fichero) → `AttachedImage[]`.
  3. Pone `setHeroSent(true)`, `setPendingChatDraft(brief)`, `setPendingChatAttachments({ images, styleDirection: aiReference })`, `setPendingChatAutoSend(true)` y abre la barra lateral en la pestaña del chat.
  4. Limpia `aiFotos`.

  El usuario ya pulsó enviar: el `autoSend` aquí es **su** envío, no uno automático.

- [ ] **Step 4: El borrador lleva fotos y referencia.** En `useAgentChat`:
  - Añade la prop `pendingAttachments`.
  - En el efecto de envío automático (`:1983`), cambia `void send(texto)` por:

```ts
    void send(texto, undefined, {
      ...(pendingAttachments?.images.length ? { images: pendingAttachments.images } : {}),
      ...(pendingAttachments?.styleDirection ? { styleDirection: pendingAttachments.styleDirection } : {}),
    });
```

  Añade `pendingAttachments` a sus dependencias y pásala desde `NewChatPanel` y `page.tsx`.

- [ ] **Step 5: La portada rellena y no envía (DeepSeek).**
  - En `components/marketing/hero-prompt-input.tsx:135`, el destino pasa a `/new?brief=${encodeURIComponent(...)}`, sin `mode=ai` ni `autostart=1`.
  - En `page.tsx`, el efecto de `autostartParam` se sustituye por uno que, con un `brief` en la URL y el proyecto en blanco cargado, **rellena** el compositor de la entrada (`setAiPrompt(brief)`) y quita `brief` y `autostart` de la URL con `router.replace`. **No envía.**
  - Las fotos en tránsito de la portada se cargan en `aiFotos` (se ven en el compositor), no se mandan.

- [ ] **Step 6: La lista oculta los blancos salvo el abierto.**
  - En `ProjectsSection` y en `/projects`, filtra `p => !p.isBlank || p.id === proyectoAbiertoId`.
  - El que se queda se rotula con la clave i18n nueva `projects.newProject` («Proyecto nuevo» / «New project» / …) en los 10 locales de `messages/`. La prueba `components/claves-de-traduccion.test.ts` exige la clave en todos.

- [ ] **Step 7: Retirar lo que ya no se usa de la entrada en `page.tsx`.** Quita `useGeneration`, `aiGenState`, `aiGenerating`, `genSlow` y el modo `ai` como flujo de generación. **No borres** todavía `lib/use-generation.ts`: eso es la Tarea 12. `npm run typecheck` dice qué queda colgando.

- [ ] **Step 8: Puertas.** Corre `npm run typecheck`, después `npx eslint` sobre los ficheros tocados y `npx vitest run components/claves-de-traduccion.test.ts components/workspace-v2/chat/chat-composer.test.tsx`.

- [ ] **Step 9: Verificar en el navegador** (build de producción, 127.0.0.1, base local). Los cinco flujos enteros, con captura de cada uno:
  1. `/new` → la URL pasa a `?project=<id>` y se ve el compositor centrado. Escribes un brief, envías: aparece el chat de Len con tu mensaje, el lienzo se llena mientras escribe, y queda guardado. Recargas: sigue ahí, con el título del `<title>`.
  2. Lo mismo con **dos fotos** y una **referencia por URL**: la burbuja enseña las dos fotos, y la página usa la paleta.
  3. Desde la portada de marketing con un brief: llega **escrito** en el compositor y **no** se envía.
  4. `/new` otra vez sin enviar nada: es **el mismo** proyecto en blanco (mismo id).
  5. La lista de proyectos: el blanco abierto sale como «Proyecto nuevo» y los demás blancos no salen.

- [ ] **Step 10: Commit**

```bash
git add app/[locale]/new/page.tsx components/workspace-v2/chat components/marketing/hero-prompt-input.tsx messages components/workspace-v2 app/[locale]/projects
git commit -m "cambiar(new): crear es el primer mensaje a Len en un proyecto en blanco, como una sesión nueva de DeepSeek"
```

---

### Task 10: Quitar las dos mediciones automáticas que DeepSeek no tiene (`verifyTurn` y `medirParaElModelo`)

> Va **antes** de medir, a propósito, no después como decía el §9 de la especificación: lo que se mide tiene que ser el Len que queda.
>
> **Decidido por Jesús el 06/10**: se van las dos. DeepSeek no mide nada por su cuenta, ni al cerrar ni tras editar (su `lsp` sólo ofrece navegación que el modelo pide). Len sólo sabe lo que mire él con `mirar_pagina` / `usar_pagina`.

**Files:**
- Modify: `lib/agent/loop.ts`:
  - la opción `verifyTurn` (`:313-331`);
  - `sinComprobar` y `noSeMiro` (`:1345`, `:1383-1385`);
  - el bloque de cierre (`:1747-2032`), del que sólo queda `finalText = turnText; return await cerrarTurno();`;
  - la opción `medirParaElModelo` (`:332-349`);
  - su línea base (`:1086-1096`, la rama `"sin-base"` y `previoPorPagina` si sólo servían a esto);
  - su rama dentro de `medirYRedactar` (`:1120-~1180`). **`medirYRedactar` se queda** para los diagnósticos estáticos de las herramientas (`outcome.diagnosticos`, `:2275`), que no se tocan en esta obra.
- Modify: `app/api/agent/route.ts`:
  - `verifyTurn:` (`:1360-~1520`);
  - `medirParaElModelo:` (`:1336-~1360`) y su comentario de la línea 388;
  - el import de `verifyEditedPage` (`:91`) si queda sin uso.
  - ⚠️ **`medirDelTurno` SE QUEDA**: es lo que usa `mirar_pagina` (`observarPagina(input, { medir: medirDelTurno })`, `:460`).
- Delete: la palanca `OPENLEN_AGENT_VISION`. Sin las dos mediciones ya no apaga nada (`grep -rn OPENLEN_AGENT_VISION app lib infra scripts`; también en `.env.example` y en las unidades de `infra/` si aparece).
- Modify: `lib/lienzo/documento.ts:81` (el comentario que cita `medirParaElModelo` como historia: se deja como historia, con «retirado el 06/10»).
- Modify: `lib/agent/manual-de-la-plataforma.ts` (una línea en `/AGENTS.md`; ver Step 5).
- Test: `lib/agent/loop.test.ts`, `app/api/agent/route.test.ts`, `lib/agent/dos-medidas-un-documento.test.ts`, `lib/agent/aviso-medido.test.ts`.

**Interfaces:**
- Produces:
  - `AgentLoopArgs` ya **no** tiene `verifyTurn` ni `medirParaElModelo`.
  - El bucle ya **no** emite la acción `verificar_diseno`, ni le manda al modelo mediciones del navegador por su cuenta.
  - `OPENLEN_AGENT_VISION` desaparece.
  - `mirar_pagina`, `usar_pagina` y `medirDelTurno` siguen igual.

- [ ] **Step 1: La prueba nueva, que falla.** En `lib/agent/loop.test.ts`, sustituye el `describe("runAgentLoop — verifyTurn", …)` (`:1325`) por:

```ts
describe("runAgentLoop — sin medición obligatoria al cerrar (plans/crear-es-len)", () => {
  it("un turno que mutó cierra sin la tarjeta verificar_diseno: mirar lo decide Len, como en Claude Code y DeepSeek", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "Write", args: { file_path: "/index.html", content: "<h1>v2</h1>" } }, done],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<h1>v2</h1>" }),
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toContain("Listo");
    expect(events.some((e) => e.type === "action" && (e as { tool?: string }).tool === "verificar_diseno")).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver qué hace.** `npx vitest run lib/agent/loop.test.ts -t "sin medición obligatoria"`. Sin `verifyTurn` pasado, esta prueba **ya pasa hoy**: es la red de seguridad. La que demuestra el cambio es que, tras el Step 3, **pasar** `verifyTurn` al bucle sea un **error de tipos** (la opción ya no existe). Compruébalo en el Step 3 con `npm run typecheck`.

- [ ] **Step 3: Quitar el código.** Borra lo listado en **Files**. Al borrar el bloque de cierre, conserva:
  - lo que hay **antes** de `// F5 — los ojos` (el empujón `puedeActuar && !actuo …`);
  - las dos líneas finales `finalText = turnText;` y `return await cerrarTurno();`.

  `npm run typecheck` señala lo que se queda sin uso:
  - `VERIFY_TOOL` sigue exportado: lo usa el cliente para pintar tarjetas viejas.
  - `VerifyOutcome` sólo si nadie más lo importa.
  - `TOPE_PAGINAS_MIRADAS`, `ultimaPorPagina` si sólo servía a esto.

  Borra sólo lo que el typecheck o `grep` digan que quedó huérfano.

- [ ] **Step 4: Las pruebas viejas.** La lista exacta sale de `grep -n "verifyTurn\|medirParaElModelo" lib/agent/loop.test.ts app/api/agent/route.test.ts lib/agent/dos-medidas-un-documento.test.ts lib/agent/aviso-medido.test.ts` (hoy: 32 + 21 en `loop.test.ts`, el resto en los otros tres).
  - **Si su sujeto es una de las dos mediciones** (la tarjeta, `no_mirado`, la cobertura, las promesas rotas, «G3 al topar se mira», «G6 el cierre con el veredicto», la línea base, «medido y limpio se dice», el fusible de tres fallos), **se borra**.
  - **Si sólo las usa como vía para probar otra cosa**:
    - Si esa otra cosa sigue existiendo (los diagnósticos estáticos de `outcome.diagnosticos`, el texto de `aviso-medido.ts`), **se le quita la opción y se queda**.
    - Si ya no existe (`dos-medidas-un-documento.test.ts`: «las dos medidas del turno son del mismo documento», sin medidas), se borra. Si la función que probaba queda sin llamadores, se borra también.
  - Anota en el mensaje del commit cuántas pruebas se borraron y por qué.

  **Nunca** dejes una prueba en verde que no ejerce nada.

- [ ] **Step 5: La línea para comprobar, en `/AGENTS.md`** (aprobada en D2: «el prompt le pide comprobar antes de decir listo»). En `manualSinPartir()` (`lib/agent/manual-de-la-plataforma.ts`):
  - Al final de `THE PROJECT'S FOLDER`, antes de `THE BACKEND`, añade la línea de abajo (en inglés, como el resto).
  - En esa misma sección, la frase «mirar_pagina, usar_pagina and the checks after each turn load these files» pierde «and the checks after each turn», que ya no existen.
  - Si el plan de renombrar herramientas ya se aplicó, usa los nombres nuevos.

```
Before you say a change is done, check it: mirar_pagina tipo="medir" is free and tells you what overflows, the contrast and the JavaScript errors; usar_pagina tries it like a visitor. Nothing checks it for you. If you couldn't check it, say so instead of claiming it works.
```

  Corre `npx vitest run lib/prompts-golden.test.ts`. El diff tiene que ser **sólo** esa línea; si es así, `-u`.

- [ ] **Step 6: Ejecutar las suites tocadas**

Run: `npx vitest run lib/agent/loop.test.ts app/api/agent/route.test.ts lib/agent/aviso-medido.test.ts lib/agent/manual-de-la-plataforma.test.ts lib/prompts-golden.test.ts` (más `lib/agent/dos-medidas-un-documento.test.ts` si sigue existiendo)
Expected: PASS.

- [ ] **Step 7: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/agent/loop.ts app/api/agent/route.ts lib/agent/manual-de-la-plataforma.ts lib/lienzo/documento.ts
git add -A lib/agent app/api/agent lib/lienzo lib/prompts-golden.test.ts lib/__snapshots__
git commit -m "retirar(len): las dos mediciones automáticas (al cerrar y tras editar) y su palanca; mirar lo decide Len, como en DeepSeek"
```

---

### Task 11: Ensayo y medición lado a lado (PAGADA: presupuesto y OK antes)

**Files:**
- Create: `plans/crear-es-len/medicion/README.md` (resultados), capturas en esa carpeta

- [ ] **Step 1: Elegir los briefs.** Seis descripciones reales de crear, variadas: un restaurante, un portafolio, un producto, un evento, un servicio local y un brief muy vago. Si `scripts/evals-pages.ts` trae un juego fijo, usa ese. Anótalos en el README.
- [ ] **Step 2: Presupuesto.** Estima el coste de 6 creaciones por cada camino:
  - **Crear**: 1 llamada (o su coste en créditos).
  - **Len**: hay que estimarlo. Usa como referencia las cifras de turnos de Len en `plans/len-2/gastos.md` y súbelo por la salida de una página entera (~9k tokens).
  - Escribe el total y **un techo** que no se pasa.
- [ ] **Step 3: PARA. Enseña a Jesús los briefs, el presupuesto y el techo, y espera su OK.** Sin OK no se corre nada.
- [ ] **Step 4: Correr.** Todo en local, con la base de 5546 y el servidor de build de producción en 127.0.0.1.
  - **Crear**: por `/api/generate`, que sigue vivo hasta la Tarea 12.
  - **Len**: por `/new` → proyecto en blanco → primer mensaje.
  - **Anotar de cada uno**: el tiempo hasta el primer trozo pintado, el tiempo total, el coste, los pasos de Len y si miró la página.
- [ ] **Step 5: Mirar las páginas antes que los números.** Haz capturas de escritorio y móvil, una al lado de la otra, en el README. Después pon la tabla de números.
- [ ] **Step 6: PARA. Enseña el resultado a Jesús.**
  - Si Len pierde en belleza o en tiempo hasta ver algo, **no se sigue** a la Tarea 12: se arregla en Len y se vuelve a medir (con otro OK).
  - Si gana o empata, sigue.

---

### Task 12: Borrar Crear

**Files:**
- Delete: `app/api/generate/` (`route.ts`, `system-prompt.ts` y sus pruebas), `lib/use-generation.ts`, `app/api/crear/escritor/`, `lib/generation/subpagina-prompt.ts`
- Delete: `lib/ai/escritor-guardado.ts` y el selector de escritor del compositor (`grep -rn "crear/escritor\|escritorGuardado\|EscritorSelect" components app lib`)
- Modify: `lib/generation/model-policy.ts` (operaciones sin llamador)
- Modify: `scripts/evals-pages.ts`: deja de medir `/api/generate`; se retira o pasa a medir con Len, según lo que diga la Tarea 11
- Modify: `lib/prompts-superficies.test.ts`, `lib/prompts-golden.test.ts` (Crear deja de ser una superficie)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Borrar y dejar que el typecheck guíe.** Borra los ficheros listados y corre `npm run typecheck`. Cada error es un importador: se arregla quitando el uso, nunca creando un sustituto. Los comentarios que **citan** `/api/generate` en otros ficheros se revisan uno a uno (`grep -rn "api/generate" app components lib --include=*.ts --include=*.tsx`):
  - si describen comportamiento vivo que ya no existe, se corrigen;
  - si son historia («⚰️ …»), se quedan.
- [ ] **Step 2: La política de modelos.** Corre `npx vitest run lib/generation/model-policy-sin-huerfanas.test.ts`. Las operaciones que se quedaron sin llamador (las de Crear: búscalas en `writerForTurn` y en la ruta borrada) se quitan de la tabla, con su lápida de una línea.
- [ ] **Step 3: Las guardas de los prompts.** En `lib/prompts-superficies.test.ts` y `lib/prompts-golden.test.ts`, quita Crear de la lista de superficies. El golden de las demás **no debe cambiar** (compruébalo con el diff).
- [ ] **Step 4: `CLAUDE.md`.**
  - La fila de `app/api/generate/` se sustituye por una línea con fecha: «⚰️ retirada el AAAA-MM-DD: crear es el primer mensaje a Len (plans/crear-es-len)».
  - El «Workspace V2 mental model» pasa a decir que sin parámetros se abre el proyecto en blanco (no hay modo `ai`).
  - La línea «🔴 Crear NO tiene bucle…» se sustituye por la decisión del 06/10 y su porqué.
  - La mención de `/api/generate` en `lib/design-guidance.ts` y en `lib/page-engine/` se corrige donde describa algo vivo.
- [ ] **Step 5: Pruebas tocadas y puertas.** Corre `npx vitest run <cada *.test.ts tocado o cuyo import cambió>`, después `npm run typecheck` y `npx eslint` sobre lo tocado.
- [ ] **Step 6: Ensayo de caja completo** (memoria `un-deploy-con-todo-ensayo-de-caja-antes`): build de producción, 127.0.0.1, https si aplica, y los cinco flujos de la Tarea 9, con captura.
- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "retirar(crear): /api/generate, su cliente, el selector de escritor y las subpáginas declaradas; crear es Len"
```

- [ ] **Step 8: PARA.** No se despliega. Se le dice a Jesús que la rama `crear-es-len` está lista, con el resumen y las capturas, y él decide.

---

## Self-review (hecho al escribir el plan)

- **Cobertura de la especificación**:

| Sección de la especificación | Tarea |
|---|---|
| §4.1 proyecto en blanco | 6, 9 |
| §4.2 enviar es el primer mensaje | 9 |
| §4.3 directo | 1, 2, 3 |
| §4.4 conocimiento | 4 |
| §4.5 páginas como ficheros | 4 (`FROM_SCRATCH`), 12 (subpágina) |
| §4.5a fotos y título | 7, 5 |
| §4.5b cobro | sin código: el de Len ya está; se mide en 11 |
| §4.6 verificación | 10 |
| §4.7 selectores | 12 |
| §5 borrado | 12 |
| §8 medición | 11 |
| §10 pruebas | en cada tarea |
| Portada | 9, paso 5 |

- **Orden cambiado respecto a §9 de la especificación**: `verifyTurn` se quita **antes** de medir (Tarea 10), para medir el Len que queda.
- **Tipos coherentes entre tareas**: `function_call_delta { index, name?, argsDelta }` (1→3), `PagePreview { page, html }` (2→3), `page_preview` (3), `isBlankProject` (6→9), `ChatPhoto` / `photosOf` / `photosForRow` (7), `send(..., { images, styleDirection })` (7, 8→9), `pendingAttachments` (9).
- **Lo que este plan NO hace** (fuera de alcance, dicho en la especificación):
  - igualar portada y páginas en la base (`data.html` / `data.pages`);
  - un selector de modelo para Len;
  - varias fotos en el compositor del chat (sólo en el de la entrada);
  - guardar la referencia por URL en el historial.
