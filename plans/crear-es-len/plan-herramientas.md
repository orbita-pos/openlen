# Las herramientas de Len, en inglés — Plan de implementación (Parte B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que las 11 herramientas de Len que hoy se llaman en español (`mirar_pagina` con `tipo="medir"`, `usar_pagina` con `pasos: [{ pulsa }]`…) se llamen, se parametricen y respondan **en inglés y en snake_case**, como las de DeepSeek (`bash`, `send_message`, `list_agents`, `get_goal`). Los turnos guardados con los nombres viejos tienen que seguir pintándose y volviendo al modelo.

**Architecture:**
- Se generaliza el precedente de la pieza 3 de Len 2.5. Allí `preguntar` pasó a `ask_user_question`, y un traductor (`currentToolName` / `currentToolCall`, hoy en `lib/agent/ask-user-question.ts:170-186`) pasa lo GUARDADO a la forma de hoy, para que el modelo nunca lea una herramienta que no tiene.
- El traductor se muda a `lib/agent/tool-renames.ts` con las 11. Después se renombra todo lo vivo: declaraciones, implementación, respuestas, cliente, voz y Len-Bench.
- Una prueba-guarda impide que vuelva un nombre en español.

**Tech Stack:** TypeScript, vitest (`include` = lista blanca), next-intl (10 locales en `messages/`).

**Spec:** decisión de Jesús del 2026-10-06 («los textos de mirar_pagina se ven asquerosos en spanish… hagámoslo como lo hace DeepSeek»), anotada en `plans/crear-es-len/diseno.md` §4.6. Va **junto** a `plans/crear-es-len/plan.md` (Parte A): misma rama, mismas reglas.

## Global Constraints

- **Todas las de la sección «Ejecución en la nube» y «Global Constraints» de `plans/crear-es-len/plan.md`** valen aquí tal cual: rama `crear-es-len`, push tras cada tarea, nunca desplegar, sólo los tests tocados, variables de prueba, `pendiente-local.md` y `estado.md`.
- **Orden: esta Parte B va DESPUÉS de la Tarea 10 de la Parte A.** La Parte A deja escritos con los nombres viejos sitios que aquí se renombran (la línea de `/AGENTS.md` de su Tarea 10). Esta parte los encuentra con la guarda de la Tarea B2.
- **Nombres nuevos: aprobados por Jesús el 2026-10-06 (tabla de abajo).** Si al implementar un nombre choca con algo existente, se para y se pregunta; no se inventa otro.
- **Sólo se renombra lo que es nombre de herramienta**: el literal entre comillas, el parámetro, el valor del `enum` y la clave de la respuesta. **Nunca** la prosa ni las rutas (`publicar` sale en 96 ficheros como palabra normal: `app/[locale]/terms/page.tsx`, botones, textos…).
- **Lo que ve el USUARIO no cambia**: las etiquetas de las tarjetas siguen localizadas («Comprobando la página»). Lo que cambia es lo que lee el MODELO y las claves internas.
- **Las filas viejas no se migran**: `projectChatMessages.actions` y las transcripciones guardadas conservan los nombres viejos. Se traducen **al leer** (como `preguntar`), nunca con un `UPDATE` sobre la base.

## Tabla de nombres

| Hoy | Nuevo | Parámetros (hoy → nuevo) | Valores (hoy → nuevo) |
|---|---|---|---|
| `activar_modulo` | `toggle_module` | `modulo`→`module`, `encender`→`on`, `numero`→ **se quita**: se declara y nunca se lee (`lib/agent/tools.ts:1130`) | — |
| `mirar_pagina` | `view_page` | `tipo`→`mode`, `pregunta`→`question`, `zona`→`area`, `file_path` igual | `medir`→`measure`, `describir`→`describe` |
| `usar_pagina` | `use_page` | `pasos`→`steps`; en cada paso: `pulsa`→`click`, `escribe`→`type`, `en`→`into`, `elige`→`choose`, `dentro_de`→`within`, `recarga`→`reload`, `lee`→`read`; `sign_in_as` y `file_path` igual | — |
| `elegir_foto` | `find_photo` | `busqueda`→`query`, `estilo`→`style` | — |
| `editar_imagen` | `edit_image` | `imagen_url`→`image_url`, `instruccion`→`instruction` | — |
| `publicar` | `publish` | `subdominio`→`subdomain`, `idiomas`→`languages` | — |
| `revertir_ultimo_cambio` | `undo_last_change` | `file_path` igual | — |
| `ver_visitas` | `get_visits` | `desde`→`from`, `hasta`→`to` | — |
| `ver_formularios` | `list_form_submissions` | `cuales`→`which`, `desde`→`from`, `hasta`→`to`, `id` igual | `nuevos`→`new`, `fecha`→`by_date`, `uno`→`one` |
| `ver_mensajes` | `list_messages` | `cuales`→`which`, `desde`→`from`, `hasta`→`to`, `id` igual | `sin_leer`→`unread`, `fecha`→`by_date`, `una`→`one` |
| `preparar_respuesta` | `draft_reply` | `para`→`channel`, `texto`→`text`, `id` igual | `chat` igual, `formulario`→`form` |

**Claves de respuesta en español** que se han encontrado (lista de partida, no exhaustiva: cada tarea lee la implementación entera de su herramienta):
- `nota`→`note`
- `encendido`→`enabled`
- `ya_en_efecto_para_visitantes`→`already_live_for_visitors`
- `respuesta`→`reply`
- `visita`→`visit`
- `fotos`→`photos`
- `estilo`→`style`
- `nueva_url`→`new_url`
- `cambiaron`→`changed`
- `ficheros`→`files`
- `fichero`→`file`
- `estado`→`state`
- `idiomas_ignorados`→`ignored_languages`
- `preguntado`→`asked`
- `revertido_a`→`reverted_to`
- `conservado`→`kept`
- `zona`→`time_zone` (en `resultados.ts`: es la zona horaria)
- `sin_ver`→`unseen`
- `hoy`→`today`
- `ayer`→`yesterday`
- `lista`→`items`
- `nota_zona`→`time_zone_note`
- `chat_activado`→`chat_enabled`
- `conversaciones_sin_leer`→`unread_conversations`
- `mensajes_sin_leer`→`unread_messages`
- `conversaciones`→`conversations`
- y las que devuelva `observarPagina` (`lib/agent/verify.ts`) para `view_page`.

## Review Focus

1. **Un turno viejo vuelve al modelo con `mirar_pagina({tipo:"medir"})`**: el modelo tiene que leer `view_page({mode:"measure"})`, nunca la herramienta vieja. → pruebas en B1, más la de `transcripcion` en B2.
2. **Un turno viejo en el chat**: su tarjeta `ver_visitas` se sigue pintando con su etiqueta («Mirando tus visitas»), no con el nombre crudo. → prueba en B3.
3. **El modelo, por costumbre, llama a `mirar_pagina`**: recibe el error de siempre («There is no tool called…», `loop.ts:~2126`), que **nombra la nueva**. → paso en B2.
4. **La tarjeta de visitas de la llamada de voz** (`lib/voz/tarjeta-de-visitas.ts` lee `r.hoy.vistas`) sigue saliendo con las claves nuevas. → paso y prueba en B2.
5. **Un `publicar` como palabra de la interfaz** (botones, rutas `/publish`, textos legales) **no se toca**. → la guarda de B2 sólo mira declaraciones y el manual, y el diff se revisa a mano.

---

### Task B1: El traductor de nombres viejos (puro)

**Files:**
- Create: `lib/agent/tool-renames.ts`, `lib/agent/tool-renames.test.ts` (+ su línea en `include` de `vitest.config.ts`, junto a `"lib/agent/catalog.test.ts"`)
- Modify: `lib/agent/ask-user-question.ts:169-186` (sus `LEGACY_TOOL_NAMES` / `currentToolName` / `currentToolCall` se mudan; deja `LEGACY_QUESTION_TOOL`)
- Modify: `lib/agent/transcripcion.ts:33`, `lib/agent/historial-saneado.ts:13` (importan del módulo nuevo)

**Interfaces:**
- Produces:
  - `TOOL_RENAMES: Readonly<Record<string, string>>` (viejo → nuevo, con `preguntar` dentro)
  - `currentToolName(name: string): string`
  - `currentToolCall(call: { name: string; args?: Record<string, unknown> }): { name: string; args: Record<string, unknown> }`
  - `LEGACY_TOOL_NAMES_FOR_CARDS: readonly string[]` (los viejos, para el cliente)

- [ ] **Step 1: Pruebas que fallan** (`lib/agent/tool-renames.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { currentToolCall, currentToolName, TOOL_RENAMES } from "./tool-renames";

describe("lo guardado con los nombres de antes, con los de hoy", () => {
  it("los once, y preguntar, que ya estaba", () => {
    expect(currentToolName("mirar_pagina")).toBe("view_page");
    expect(currentToolName("preparar_respuesta")).toBe("draft_reply");
    expect(currentToolName("preguntar")).toBe("ask_user_question");
    expect(Object.keys(TOOL_RENAMES)).toHaveLength(12);
  });

  it("un nombre de hoy o desconocido pasa igual", () => {
    expect(currentToolName("view_page")).toBe("view_page");
    expect(currentToolName("Read")).toBe("Read");
  });

  it("🔴 mirar_pagina({tipo:'medir'}) vuelve como view_page({mode:'measure'})", () => {
    expect(currentToolCall({ name: "mirar_pagina", args: { tipo: "medir", pregunta: "¿desborda?", zona: "el hero", file_path: "/index.html" } })).toEqual({
      name: "view_page",
      args: { mode: "measure", question: "¿desborda?", area: "el hero", file_path: "/index.html" },
    });
  });

  it("los pasos de usar_pagina se traducen uno a uno", () => {
    expect(
      currentToolCall({
        name: "usar_pagina",
        args: { pasos: [{ pulsa: "Añadir", dentro_de: "Taco" }, { escribe: "Ana", en: "Nombre" }, { elige: "Grande" }, { recarga: true }, { lee: "Total" }] },
      }),
    ).toEqual({
      name: "use_page",
      args: { steps: [{ click: "Añadir", within: "Taco" }, { type: "Ana", into: "Nombre" }, { choose: "Grande" }, { reload: true }, { read: "Total" }] },
    });
  });

  it("los valores del enum también", () => {
    expect(currentToolCall({ name: "ver_mensajes", args: { cuales: "sin_leer" } }).args).toEqual({ which: "unread" });
    expect(currentToolCall({ name: "preparar_respuesta", args: { para: "formulario", id: "f1", texto: "Hola" } }).args).toEqual({ channel: "form", id: "f1", text: "Hola" });
  });

  it("numero, que nunca se leyó, desaparece", () => {
    expect(currentToolCall({ name: "activar_modulo", args: { modulo: "chat", encender: true, numero: "+52" } }).args).toEqual({ module: "chat", on: true });
  });

  it("preguntar conserva su traducción de forma (pieza 3)", () => {
    expect(currentToolCall({ name: "preguntar", args: { texto: "¿Azul?" } })).toEqual({
      name: "ask_user_question",
      args: { questions: [{ id: "q1", question: "¿Azul?" }] },
    });
  });

  it("una llamada de hoy no se toca", () => {
    const hoy = { name: "view_page", args: { mode: "describe", question: "x" } };
    expect(currentToolCall(hoy)).toEqual(hoy);
  });
});
```

- [ ] **Step 2: Añadir a `include`, ejecutar y ver que falla.** Run: `npx vitest run lib/agent/tool-renames.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementar** `lib/agent/tool-renames.ts`:

```ts
/**
 * LOS NOMBRES DE ANTES — lo GUARDADO (historial, transcripción, tarjetas,
 * grabaciones) con los nombres y la forma de hoy, para que el modelo nunca lea
 * una llamada a una herramienta que no tiene. Generaliza lo que la pieza 3 de
 * Len 2.5 hizo con `preguntar` → `ask_user_question`.
 *
 * Las 11 en español pasaron al inglés el 2026-10-06, como las de DeepSeek
 * (plans/crear-es-len/plan-herramientas.md). Sólo se traduce al LEER: la base
 * no se migra.
 *
 * Puro: lo importan la transcripción, el saneado del historial y el chat (cliente).
 */
import { ASK_USER_QUESTION, LEGACY_QUESTION_TOOL } from "./ask-user-question";

export const TOOL_RENAMES: Readonly<Record<string, string>> = {
  [LEGACY_QUESTION_TOOL]: ASK_USER_QUESTION,
  activar_modulo: "toggle_module",
  mirar_pagina: "view_page",
  usar_pagina: "use_page",
  elegir_foto: "find_photo",
  editar_imagen: "edit_image",
  publicar: "publish",
  revertir_ultimo_cambio: "undo_last_change",
  ver_visitas: "get_visits",
  ver_formularios: "list_form_submissions",
  ver_mensajes: "list_messages",
  preparar_respuesta: "draft_reply",
};

/** Para el cliente: los nombres viejos que una tarjeta guardada puede traer. */
export const LEGACY_TOOL_NAMES_FOR_CARDS: readonly string[] = Object.keys(TOOL_RENAMES);

const KEYS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  // `null` = se quita: `numero` se declaraba y nunca se leía.
  activar_modulo: { modulo: "module", encender: "on", numero: null },
  mirar_pagina: { tipo: "mode", pregunta: "question", zona: "area" },
  usar_pagina: { pasos: "steps" },
  elegir_foto: { busqueda: "query", estilo: "style" },
  editar_imagen: { imagen_url: "image_url", instruccion: "instruction" },
  publicar: { subdominio: "subdomain", idiomas: "languages" },
  ver_visitas: { desde: "from", hasta: "to" },
  ver_formularios: { cuales: "which", desde: "from", hasta: "to" },
  ver_mensajes: { cuales: "which", desde: "from", hasta: "to" },
  preparar_respuesta: { para: "channel", texto: "text" },
};

const VALUES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  mirar_pagina: { tipo: { medir: "measure", describir: "describe" } },
  ver_formularios: { cuales: { nuevos: "new", fecha: "by_date", uno: "one" } },
  ver_mensajes: { cuales: { sin_leer: "unread", fecha: "by_date", una: "one" } },
  preparar_respuesta: { para: { formulario: "form" } },
};

const STEP_KEYS: Readonly<Record<string, string>> = {
  pulsa: "click",
  escribe: "type",
  en: "into",
  elige: "choose",
  dentro_de: "within",
  recarga: "reload",
  lee: "read",
};

/** El nombre de hoy de una herramienta que pudo guardarse con el de antes. */
export function currentToolName(name: string): string {
  return Object.hasOwn(TOOL_RENAMES, name) ? TOOL_RENAMES[name]! : name;
}

const renameKeys = (o: Record<string, unknown>, map: Readonly<Record<string, string | null>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Object.hasOwn(map, k)) {
      const nuevo = map[k];
      if (nuevo !== null && nuevo !== undefined) out[nuevo] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
};

/** Una llamada guardada, con el nombre y la forma de hoy. */
export function currentToolCall(call: { name: string; args?: Record<string, unknown> }): { name: string; args: Record<string, unknown> } {
  const args = call.args ?? {};
  if (call.name === LEGACY_QUESTION_TOOL) {
    const texto = typeof args.texto === "string" ? args.texto : "";
    return { name: ASK_USER_QUESTION, args: { questions: [{ id: "q1", question: texto }] } };
  }
  if (!Object.hasOwn(TOOL_RENAMES, call.name)) return { name: call.name, args };
  const values = VALUES[call.name] ?? {};
  const conValores: Record<string, unknown> = { ...args };
  for (const [clave, mapa] of Object.entries(values)) {
    const v = conValores[clave];
    if (typeof v === "string" && Object.hasOwn(mapa, v)) conValores[clave] = mapa[v];
  }
  const renamed = renameKeys(conValores, KEYS[call.name] ?? {});
  if (call.name === "usar_pagina" && Array.isArray(renamed.steps)) {
    renamed.steps = renamed.steps.map((p) =>
      p && typeof p === "object" && !Array.isArray(p) ? renameKeys(p as Record<string, unknown>, STEP_KEYS) : p,
    );
  }
  return { name: TOOL_RENAMES[call.name]!, args: renamed };
}
```

  En `lib/agent/ask-user-question.ts`, borra `LEGACY_TOOL_NAMES`, `currentToolName` y `currentToolCall` (líneas 169-186) y deja una línea: `// ⚰️ currentToolName / currentToolCall se mudaron a ./tool-renames.ts (2026-10-06), con las 11 herramientas que pasaron al inglés.`. Cambia los imports de `transcripcion.ts:33` y `historial-saneado.ts:13` a `@/lib/agent/tool-renames`.

  ⚠️ **Import circular**: `tool-renames.ts` importa de `ask-user-question.ts`. Si `ask-user-question.ts` llegara a importar de `tool-renames.ts`, sustituye ese uso por el literal.

- [ ] **Step 4: Ejecutar**

Run: `npx vitest run lib/agent/tool-renames.test.ts lib/agent/transcripcion.test.ts lib/agent/historial-saneado.test.ts` (sólo los que existan: `ls lib/agent/transcripcion.test.ts lib/agent/historial-saneado.test.ts`)
Expected: PASS.

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npx eslint lib/agent/tool-renames.ts lib/agent/ask-user-question.ts lib/agent/transcripcion.ts lib/agent/historial-saneado.ts
git add lib/agent/tool-renames.ts lib/agent/tool-renames.test.ts lib/agent/ask-user-question.ts lib/agent/transcripcion.ts lib/agent/historial-saneado.ts vitest.config.ts
git commit -m "sumar(len): el traductor de nombres de herramientas viejos, generalizado desde preguntar"
```

---

### Task B2: El servidor habla inglés (declaraciones, implementación, respuestas)

**Files:**
- Create: `lib/agent/tools-in-english.test.ts` (+ `include`): la guarda
- Modify (las declaraciones): `lib/agent/catalog.ts:174-470`
- Modify (implementación y respuestas):
  - `lib/agent/tools.ts` (el `switch` de `:2025-2071` y cada `toolXxx`);
  - `lib/agent/usar-pagina.ts`, `lib/agent/pasos-de-uso.ts` (los verbos de los pasos y sus errores);
  - `lib/agent/resultados.ts` (respuestas de `get_visits`, `list_form_submissions`, `list_messages`, `draft_reply`);
  - `lib/agent/photo-search.ts`, `lib/agent/deshacer-lo-de-len.ts`, `lib/agent/verify.ts` (`observarPagina`).
- Modify (listas y menciones):
  - `lib/agent/tool-concurrency.ts`, `lib/agent/concurrency-limit.ts`, `lib/agent/loop.ts`, `lib/agent/terminal/declaracion.ts`, `lib/agent/terminal/ajustes.ts`, `lib/agent/terminal/solo-lectura.ts`;
  - `lib/agent/herramientas-de-ficheros.ts`, `lib/agent/aviso-medido.ts`, `lib/agent/diagnosticos-de-la-escritura.ts`;
  - `lib/agent/manual-de-la-plataforma.ts` (prosa de `/AGENTS.md`, también la línea de la Tarea 10 de la Parte A);
  - `lib/ai/origen-de-medida.ts`, `lib/ai/visual-quality-renderer.ts`, `lib/backend/auth/visit-session.ts`, `lib/security/render-ssrf-guard.ts`, `lib/lienzo/documento.ts` (sólo donde nombren la herramienta);
  - `app/api/agent/route.ts`, `lib/projects.ts`, `lib/projects/settings-patch.ts`.
- Modify (voz):
  - `lib/voz/tarjeta-de-visitas.ts` (lee `r.hoy.vistas`: pasa a las claves nuevas);
  - `app/api/voz/visitas/route.ts`;
  - `components/llamada/puente-a-len.ts` (mapea nombres de herramienta a tarjetas).
- Test: `lib/agent/catalog.test.ts`, `lib/agent/tools*.test.ts`, `lib/agent/loop.test.ts`, `lib/agent/pasos-de-uso.test.ts`, `lib/voz/**`, `lib/prompts-golden.test.ts`: los que el cambio toque.

**Interfaces:**
- Consumes: `TOOL_RENAMES` (B1).
- Produces: `buildFunctionDeclarations()` sólo con nombres, parámetros y valores en inglés; las respuestas de las 11, con claves en inglés.

- [ ] **Step 1: La guarda, que falla** (`lib/agent/tools-in-english.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { buildFunctionDeclarations } from "./catalog";
import { buildManualDeLaPlataforma, documentosDeLaPlataforma } from "./manual-de-la-plataforma";
import { TOOL_RENAMES } from "./tool-renames";

// Lo que se retiró: nombres de herramienta, claves y valores en español.
const VIEJOS_NOMBRES = Object.keys(TOOL_RENAMES);
const VIEJAS_CLAVES = [
  "modulo", "encender", "numero", "tipo", "pregunta", "zona", "pasos", "pulsa", "escribe", "en", "elige",
  "dentro_de", "recarga", "lee", "busqueda", "estilo", "imagen_url", "instruccion", "subdominio", "idiomas",
  "desde", "hasta", "cuales", "para", "texto",
];
const VIEJOS_VALORES = ["medir", "describir", "nuevos", "fecha", "uno", "sin_leer", "una", "formulario"];

function walk(schema: unknown, keys: string[], values: string[]): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as { properties?: Record<string, unknown>; items?: unknown; enum?: unknown[] };
  if (Array.isArray(s.enum)) values.push(...s.enum.filter((v): v is string => typeof v === "string"));
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    keys.push(k);
    walk(v, keys, values);
  }
  walk(s.items, keys, values);
}

describe("las herramientas de Len, en inglés (como DeepSeek)", () => {
  for (const mode of ["len", "dynamis"] as const) {
    it(`ningún nombre, parámetro ni valor en español (${mode})`, () => {
      const decls = buildFunctionDeclarations({}, {}, mode) as { name: string; description?: string; parameters?: unknown }[];
      const keys: string[] = [];
      const values: string[] = [];
      for (const d of decls) walk(d.parameters, keys, values);
      expect(decls.map((d) => d.name).filter((n) => VIEJOS_NOMBRES.includes(n))).toEqual([]);
      expect(keys.filter((k) => VIEJAS_CLAVES.includes(k))).toEqual([]);
      expect(values.filter((v) => VIEJOS_VALORES.includes(v))).toEqual([]);
      for (const d of decls) {
        for (const viejo of VIEJOS_NOMBRES) expect(d.description ?? "").not.toContain(viejo);
      }
    });
  }

  it("el manual tampoco nombra las viejas", () => {
    const textos = [buildManualDeLaPlataforma({}), ...Object.values(documentosDeLaPlataforma())];
    for (const t of textos) for (const viejo of VIEJOS_NOMBRES) expect(t).not.toContain(viejo);
  });
});
```

  ⚠️ `"preguntar"` está en `TOOL_RENAMES` y también es una palabra normal en español. La guarda la busca en descripciones y manual, que están en inglés, así que no debería chocar. Si choca con prosa legítima, sácala de `VIEJOS_NOMBRES` en la guarda y explícalo con un comentario. **Nunca** relajes las otras.

  Run: `npx vitest run lib/agent/tools-in-english.test.ts`. Expected: FAIL, con la lista de todo lo que falta. **Esa lista es el inventario de esta tarea.**

- [ ] **Step 2: Las declaraciones.** En `lib/agent/catalog.ts`, renombra los 11 `name:`, sus `properties`, los `enum` y `required` según la tabla. Reescribe las descripciones para que nombren lo nuevo:
  - `'tipo="medir" is answered by the browser…'` → `'mode="measure" is answered by the browser…'`;
  - `'"medir" or "describir".'` → `'"measure" or "describe".'`;
  - los ejemplos de pasos `{"pulsa":"Add"}` → `{"click":"Add"}`.

  Quita `numero` de `toggle_module`. Las capacidades de `buildFunctionDeclarations` (`fuera.add("mirar_pagina")`, `:134-135`) pasan a los nombres nuevos.

- [ ] **Step 3: La implementación.** En `lib/agent/tools.ts`, el `switch` (`:2025-2071`) usa los nombres nuevos. Cada `toolXxx` lee los parámetros nuevos (`args.mode === "describe"`…) y sus mensajes de error los nombran. Las claves de respuesta van según la tabla.
  - `pasos-de-uso.ts`: `VERBOS = ["click", "type", "choose", "reload", "read"]`, `CLAVES` con `into` y `within`, el tipo del paso y todos sus mensajes de error (`'"steps" has to be a list…, e.g. [{"click":"Add"},{"read":"Total"}]'`).
  - **Renombra los identificadores de TypeScript sólo si son nuevos o están en la superficie que cambia** (p. ej. un tipo `PasoDeUso` puede quedarse; su clave `pulsa`, no). Nada de renombrar por gusto.

- [ ] **Step 4: Las listas y menciones.** Corre `grep -rnE "\"(activar_modulo|mirar_pagina|usar_pagina|elegir_foto|editar_imagen|publicar|revertir_ultimo_cambio|ver_visitas|ver_formularios|ver_mensajes|preparar_respuesta)\"" lib app components scripts --include=*.ts --include=*.tsx --include=*.mjs | grep -v "\.test\." | grep -v tool-renames.ts`. Cada resultado es un literal de herramienta, salvo los de `components/` (son la Tarea B3). Cámbialo al nombre nuevo, **excepto** los que existen para leer lo guardado (`KNOWN_TOOLS` del cliente, en B3). Después las menciones en prosa dirigidas al modelo (descripciones, manual, avisos de `aviso-medido.ts`, `herramientas-de-ficheros.ts`, el mensaje de herramienta desconocida de `loop.ts:~2126`): `grep -rn "mirar_pagina\|usar_pagina\|…"` sin comillas, una a una.
  - **El error de herramienta desconocida.** Si el modelo llama a una vieja, `loop.ts` responde `There is no tool called "X".` Añádele: si `currentToolName(X) !== X`, `` ` It is called "${currentToolName(X)}" now.` ``. Prueba en `loop.test.ts`:

```ts
  it("llamar a una herramienta por su nombre viejo dice cómo se llama ahora", async () => {
    const msgs: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "mirar_pagina", args: { tipo: "medir", pregunta: "x" } }, done],
      [{ type: "text_delta", text: "ok" }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [{ name: "view_page" }],
      openStream: (m) => { msgs.push([...m]); return stream(m); },
      runTool: async () => { throw new Error("no debe ejecutarse"); },
      emit: () => {},
    });
    expect(JSON.stringify(msgs.at(-1))).toContain('It is called \\"view_page\\" now');
  });
```

  (Antes de fijarla, comprueba la forma en que el bucle conoce las herramientas disponibles: `grep -n "There is no tool called" lib/agent/loop.ts` y las líneas de alrededor. Ajusta `tools:` a esa forma.)

- [ ] **Step 5: La voz.**
  - `lib/voz/tarjeta-de-visitas.ts` lee las claves nuevas de la respuesta de `get_visits` (`r.today.views`… según cómo quede `resultados.ts`).
  - `components/llamada/puente-a-len.ts` mapea los nombres nuevos y, para lo guardado, `currentToolName(...)` antes de mapear.
  - Corre `npx vitest run lib/voz components/llamada app/api/voz` (sólo los ficheros `*.test.*` que existan ahí).

- [ ] **Step 6: Ejecutar la guarda y lo tocado**

Run: `npx vitest run lib/agent/tools-in-english.test.ts lib/agent/catalog.test.ts lib/agent/loop.test.ts lib/agent/pasos-de-uso.test.ts` + cada `*.test.ts` de los ficheros tocados (`git diff --name-only | sed 's/\.ts$/.test.ts/' | xargs ls 2>/dev/null`).
Expected: PASS. Las pruebas que afirmaban sobre nombres o claves viejos **se actualizan a los nuevos**, no se borran.

- [ ] **Step 7: La golden.** Corre `NEXT_PUBLIC_PUBLISH_BASE_HOST=openlen.app npx vitest run lib/prompts-golden.test.ts`. El diff tiene que ser **sólo** renombrados de la tabla. Si es así, `-u` (con la misma variable). Si aparece cualquier otra cosa, para.

- [ ] **Step 8: Puertas y commit**

```bash
npm run typecheck
npx eslint $(git diff --name-only -- '*.ts' '*.tsx')
git add -A lib app scripts vitest.config.ts
git commit -m "traducir(len): las 11 herramientas en inglés, con sus parámetros, valores y respuestas, como las de DeepSeek"
```

---

### Task B3: El cliente: las tarjetas viejas y las nuevas

**Files:**
- Modify: `components/workspace-v2/agent-action-card.tsx:120-205` (`KNOWN_TOOLS`) y `:355` (la etiqueta)
- Modify: `components/workspace-v2/chat/live-status.ts`, `components/workspace-v2/panels/turno-cerrado.ts`, `components/workspace-v2/agent-reply-card.tsx`
- Modify: `components/workspace-v2/chat/use-agent-chat.ts:1612-1618` (`c.action === "publicar"` de la tarjeta de confirmación) y las menciones a `activar_modulo` / `preparar_respuesta`
- Modify: `components/llamada/tarjetas.tsx`, `app/[locale]/dev/chat/scripts.ts`
- Modify: `messages/<locale>/wsPage.json` ×10 (`agent.tool.<nombre>`)
- Test: `components/workspace-v2/chat/action-cards.test.ts`, `components/workspace-v2/chat/live-status.test.ts`, `components/claves-de-traduccion.test.ts`

**Interfaces:**
- Consumes: `currentToolName`, `LEGACY_TOOL_NAMES_FOR_CARDS` (B1).

- [ ] **Step 1: Prueba que falla** en `components/workspace-v2/chat/action-cards.test.ts`. Usa la forma de las pruebas que ya tiene ese fichero para montar una tarjeta (léelas primero) y añade dos casos:
  - una acción guardada `{ tool: "ver_visitas", status: "done", summary: "" }` pinta la etiqueta de `get_visits` («Mirando tus visitas» en `es`);
  - una acción nueva `{ tool: "view_page", … }` pinta «Comprobando la página».

  Run: `npx vitest run components/workspace-v2/chat/action-cards.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implementar.**
  - En `agent-action-card.tsx`:
    - `KNOWN_TOOLS` lleva los nombres nuevos.
    - Los 11 viejos se quitan de la lista: se resuelven con `currentToolName`.
    - La etiqueta pasa a:

```ts
  const tool = currentToolName(action.tool);
  const label = KNOWN_TOOLS.has(tool) ? t(`agent.tool.${tool}`) : action.tool;
```

    y todo lo que dentro del componente compara `action.tool` con un nombre (`summaryLabel`, la tarjeta de terminal, los ficheros…) compara `tool`.
  - Lo mismo en `live-status.ts`, `turno-cerrado.ts` y `agent-reply-card.tsx`: normaliza con `currentToolName` en la entrada y compara con los nombres nuevos.
  - En `messages/*/wsPage.json` (los 10), **renombra la clave** `agent.tool.mirar_pagina` → `agent.tool.view_page`, etc., **sin tocar el texto**.
  - En `use-agent-chat.ts`, la tarjeta de confirmación: el servidor (B2) emite `action: "publish"`, y el cliente compara con `"publish"`.

- [ ] **Step 3: Ejecutar**

Run: `npx vitest run components/workspace-v2/chat/action-cards.test.ts components/workspace-v2/chat/live-status.test.ts components/claves-de-traduccion.test.ts`
Expected: PASS.

- [ ] **Step 4: Puertas y commit**

```bash
npm run typecheck
npx eslint components/workspace-v2/agent-action-card.tsx components/workspace-v2/chat/live-status.ts components/workspace-v2/panels/turno-cerrado.ts components/workspace-v2/agent-reply-card.tsx components/workspace-v2/chat/use-agent-chat.ts components/llamada/tarjetas.tsx
git add -A components messages app/[locale]/dev
git commit -m "traducir(chat): las tarjetas con los nombres nuevos, y las de turnos viejos siguen pintándose"
```

---

### Task B4: Len-Bench y lo que queda

**Files:**
- Modify: `lib/len-bench/casos/resultados/*.ts`, `lib/len-bench/juez.ts`, `scripts/len-bench-disparos.ts` (comparan nombres de herramienta en las grabaciones)
- Modify: `scripts/build-migrations.mjs` (sólo si nombra la herramienta como tal; si es prosa, no)
- Test: `lib/len-bench/**/*.test.ts` tocados

- [ ] **Step 1: Inventario final.** Corre `grep -rnE "\b(activar_modulo|mirar_pagina|usar_pagina|elegir_foto|editar_imagen|revertir_ultimo_cambio|ver_visitas|ver_formularios|ver_mensajes|preparar_respuesta)\b" lib app components scripts --include=*.ts --include=*.tsx --include=*.mjs | grep -v "tool-renames"`. Sin `publicar`, que da falsos positivos: ese se repasa con la lista de B2. Cada línea que quede es:
  - **una del traductor** (no hay más fuera de `tool-renames.ts`);
  - **historia** («⚰️», «se llamaba»): se queda;
  - **o algo que falta**: se cambia.
- [ ] **Step 2: Len-Bench.** Los casos y el juez buscan las herramientas por nombre en lo que Len hizo. Pásalos a los nombres nuevos, y donde lean grabaciones **viejas**, normaliza con `currentToolName`. Así una grabación de antes sigue puntuando igual.
- [ ] **Step 3: Ejecutar** los tests de `lib/len-bench` tocados, `npm run typecheck` y eslint.
- [ ] **Step 4: Commit**

```bash
git add -A lib/len-bench scripts
git commit -m "traducir(len-bench): los casos y el juez con los nombres nuevos, leyendo las grabaciones viejas"
```

- [ ] **Step 5: Estado.** Añade a `plans/crear-es-len/estado.md` lo de la Parte B (qué se hizo y qué pasó) y, si algo no se pudo, a `pendiente-local.md`. Después `git add -f`, commit, push y **para**.

---

## Self-review (hecho al escribir el plan)

- **Cobertura**:
  - Lo que se renombra: los nombres (B2), los parámetros y valores (B2, con la guarda), las respuestas (B2), el cliente (B3), la voz (B2 paso 5, B3) y Len-Bench (B4).
  - Lo guardado: transcripción y saneado (B1), tarjetas (B3), grabaciones (B4).
  - El modelo que llama a la vieja: B2, paso 4.
- **Tipos coherentes**: `currentToolName` / `currentToolCall` / `TOOL_RENAMES` / `LEGACY_TOOL_NAMES_FOR_CARDS` (B1 → B2, B3, B4).
- **Fuera de alcance**: los nombres en español de funciones internas de TypeScript (`toolMirarPagina`…) no se renombran salvo que sean superficie. Sólo cambia lo que ve el modelo y las claves que cruzan el cable.
