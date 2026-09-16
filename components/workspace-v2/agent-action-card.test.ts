import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentActionCard, coberturaTitle, summaryLabel } from "./agent-action-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mismo pasapuertas de claves que reference-field.test.tsx: las aserciones
// miran la clave cruda, así que no hace falta cargar los mensajes.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
import type { AgentAction } from "./agent-action-card";
import { KNOWN_TOOLS } from "./agent-action-card";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Los diez que se publican. Si se añade uno y su fichero no tiene las
 *  etiquetas, esto lo dice el mismo día. */
const LOCALES = ["es", "en", "de", "fr", "it", "ja", "ko", "nl", "pt", "zh"] as const;

// F4-T8 hardening: summaryLabel is the seam where the agent's action-card
// summary either gets localized (for the tools that send a stable CODE) or
// passes through verbatim (everything else — module ids, slugs, and
// model-authored free text).
//
// Aquí vivía además un guardia de colisión: `cambiar_motion` mandaba un "off"
// que era un valor REAL —un Motion Look que se llamaba así— mientras que el
// "off" de `activar_3d`/`poner_musica` era un código a traducir. Las tres
// herramientas se retiraron el 2026-08-26 con sus módulos: ya no hay dos
// significados de "off" que separar, y las pruebas que los separaban se van
// con ellas en vez de quedarse debilitadas.
//
// A trivial mock `t` (key → key) is enough: a localized result comes back as
// the i18n KEY (never the raw code), a passthrough comes back as the input
// verbatim — so "is it the key vs the raw value" fully distinguishes the two
// branches without loading next-intl.
const t = ((key: string) => key) as unknown as Parameters<typeof summaryLabel>[1];

function action(tool: string, summary: string): AgentAction {
  return { tool, status: "done", summary };
}

describe("summaryLabel (F4-T8 i18n mapping)", () => {
  it("(c) editar_pagina free-text summary is rendered verbatim", () => {
    expect(summaryLabel(action("editar_pagina", "titular menú"), t)).toBe("titular menú");
  });

  it("(d) trabajar_en_pagina '' home sentinel → localized home label", () => {
    const out = summaryLabel(action("trabajar_en_pagina", ""), t);
    expect(out).toBe("agent.action.home");
    expect(out).not.toBe("");
  });

  it("(d') trabajar_en_pagina real slug is verbatim, NOT the home label", () => {
    // The "principal"-as-a-real-slug edge case: only the "" sentinel means
    // home; a genuine slug (even one literally named "principal") passes
    // through so it stays distinguishable from a home switch.
    expect(summaryLabel(action("trabajar_en_pagina", "principal"), t)).toBe("principal");
  });
});

// ─── que la tarjeta SEPA cómo se llama lo que está pasando ───────────────────
//
// Esta lista estaba escrita a mano y pedía «keep in sync» en un comentario.
// No se sincronizó: `conectar_datos_vivos` emite tarjeta desde que existe y
// nunca tuvo etiqueta, así que al usuario le salía `conectar_datos_vivos` en
// crudo. Una lista a mano no avisa de lo que le falta — este guardia sí.
describe("toda herramienta que deja tarjeta tiene NOMBRE", () => {
  const declaradas = buildFunctionDeclarations().map((d) => String(d.name));

  it.each(declaradas)("%s está en KNOWN_TOOLS", (name) => {
    expect(KNOWN_TOOLS.has(name), `${name} enseñaría su nombre crudo`).toBe(true);
  });

  /**
   * Y estar en la lista no basta: `t()` busca la clave en los mensajes. Sin
   * ella el usuario ve `agent.tool.loquesea` —peor que el nombre crudo— y en
   * los otros nueve idiomas, además, en silencio.
   */
  it.each(LOCALES)("y una etiqueta en %s", (loc) => {
    const tool = JSON.parse(
      readFileSync(join(process.cwd(), "messages", loc, "wsPage.json"), "utf-8"),
    ).agent.tool as Record<string, string>;
    const faltan = [...KNOWN_TOOLS].filter((n) => !tool[n]);
    expect(faltan, `sin traducir en ${loc}`).toEqual([]);
  });
});

// ─── «no pude mirar» tiene que verse ────────────────────────────────────────
//
// Los ojos fallan abiertos (Chrome caído, sin key, timeout), y hasta hoy eso
// enseñaba la MISMA tarjeta que una verificación de verdad. La tarjeta es el
// único sitio donde el usuario puede enterarse de que nadie miró su página.
describe("la verificación visual dice cuál de las tres cosas pasó", () => {
  it("miró y está bien", () => {
    expect(summaryLabel(action("verificar_diseno", "ok"), t)).toBe("agent.action.visualOk");
  });

  it("miró y hay rotura", () => {
    expect(summaryLabel(action("verificar_diseno", "issues"), t)).toBe(
      "agent.action.visualIssues",
    );
  });

  it("NO pudo mirar — y no se disfraza del visto bueno", () => {
    const out = summaryLabel(action("verificar_diseno", "no-mirado"), t);
    expect(out).toBe("agent.action.visualNoLook");
    expect(out).not.toBe("agent.action.visualOk");
  });

  // 🔴 EL CUARTO DESENLACE, que hasta el 2026-09-16 se disfrazaba del primero:
  // se miró la captura y los errores de JavaScript, pero el medidor
  // determinista no contestó, así que el desborde en móvil y el contraste NO se
  // comprobaron. Salía con el mismo «sin problemas» que una verificación
  // entera — el mismo defecto que ya arregló `no-mirado`, un caso más arriba.
  it("🔴 miró la captura pero no midió — y tampoco se disfraza", () => {
    const out = summaryLabel(action("verificar_diseno", "ok-sin-medida"), t);
    expect(out).toBe("agent.action.visualOkSinMedida");
    expect(out).not.toBe("agent.action.visualOk");
    expect(out).not.toBe("agent.action.visualNoLook");
  });
});

// ─── LA FRASE DE COBERTURA: qué cubre la comprobación y qué NO ───────────────
//
// La vara es el informe de `preview` de Claude Code, visto de Claude Code: nunca
// dice «está bien» a secas, dice qué cubrieron las comprobaciones mecánicas y
// que NO dicen si la página se ve bien. La tarjeta decía «sin problemas» y
// punto, que un creador lee como «la página está bien».
describe("la tarjeta dice qué cubrió la comprobación", () => {
  it("cuando midió y salió limpia, la cobertura completa", () => {
    expect(coberturaTitle(action("verificar_diseno", "ok"), t)).toBe(
      "agent.action.visualCobertura",
    );
  });

  it("cuando encontró problemas, la MISMA cobertura — el alcance no cambia", () => {
    expect(coberturaTitle(action("verificar_diseno", "issues"), t)).toBe(
      "agent.action.visualCobertura",
    );
  });

  // 🔴 LA QUE IMPORTA: sin medida no se puede afirmar el desborde ni el
  // contraste. Decir la cobertura completa aquí sería la mentira que esta
  // frase existe para no contar.
  it("🔴 sin medida, una cobertura DISTINTA — no se afirma lo que nadie midió", () => {
    const sinMedida = coberturaTitle(action("verificar_diseno", "ok-sin-medida"), t);
    expect(sinMedida).toBe("agent.action.visualCoberturaSinMedida");
    expect(sinMedida).not.toBe("agent.action.visualCobertura");
  });

  it("CONTRA-PRUEBA: mientras corre y cuando nadie miró, no hay cobertura que contar", () => {
    expect(coberturaTitle(action("verificar_diseno", ""), t)).toBeUndefined();
    expect(coberturaTitle(action("verificar_diseno", "no-mirado"), t)).toBeUndefined();
  });

  it("CONTRA-PRUEBA: otras herramientas no llevan cobertura", () => {
    expect(coberturaTitle(action("editar_texto", "hero"), t)).toBeUndefined();
  });

  // Las cuatro claves, en los diez idiomas. Sin esto el usuario ve
  // `agent.action.visualCobertura` en crudo, y en nueve idiomas en silencio.
  it.each(LOCALES)("y las cuatro claves están en %s", (loc) => {
    const accion = JSON.parse(
      readFileSync(join(process.cwd(), "messages", loc, "wsPage.json"), "utf-8"),
    ).agent.action as Record<string, string>;
    for (const k of ["visualOk", "visualOkSinMedida", "visualCobertura", "visualCoberturaSinMedida"]) {
      expect(accion[k], `${k} sin traducir en ${loc}`).toBeTruthy();
    }
    // 🔴 LA COBERTURA TIENE QUE DECIR LAS DOS MITADES: qué mira, y que NO dice
    // si la página se ve bien. Lo segundo es lo que la separa de «está todo
    // bien», que es el defecto que esta frase existe para no cometer.
    //
    // ⚠️ ESTAS DOS ASERCIONES SON UN SUELO, NO LA PRUEBA. Que las dos mitades
    // estén de verdad lo juzga quien lee la frase; aquí sólo se impide que
    // alguien la sustituya por una etiqueta corta. El primer intento fue
    // `length > 60` y se puso ROJO en chino con una traducción correcta —el
    // CJK dice lo mismo en 58 caracteres— así que el umbral va al suelo de
    // TODOS los alfabetos y lo que de verdad discrimina es el `JavaScript`:
    // una frase que ya no nombra un eje concreto dejó de ser una cobertura.
    expect(
      accion.visualCobertura,
      `la cobertura de ${loc} ya no nombra ningún eje concreto`,
    ).toContain("JavaScript");
    expect(
      accion.visualCobertura!.length,
      `la cobertura de ${loc} se quedó en una etiqueta`,
    ).toBeGreaterThan(40);
  });

  it("mientras corre, sin texto", () => {
    expect(summaryLabel(action("verificar_diseno", ""), t)).toBe("");
  });

  // La clave tiene que EXISTIR en los diez idiomas: si falta, el usuario ve
  // `agent.action.visualNoLook` en crudo, y en los otros nueve en silencio.
  it.each(LOCALES)("y su texto está en %s", (loc) => {
    const accion = JSON.parse(
      readFileSync(join(process.cwd(), "messages", loc, "wsPage.json"), "utf-8"),
    ).agent.action as Record<string, string>;
    expect(accion.visualNoLook, `sin traducir en ${loc}`).toBeTruthy();
  });
});

// ─── el corte de la ventana también se dice, y en los diez ───────────────────
//
// 🔴 Al MODELO ya se le decía que la conversación no cabe entera. Al usuario no:
// veía a Len olvidar y no tenía forma de saber por qué. La frase la compone el
// cliente con los dos números que manda el servidor —datos, no prosa— así que
// necesita su clave en los diez idiomas, y con los dos marcadores dentro: sin
// ellos la frase sale sin los números y vuelve a ser una disculpa en vez de un
// hecho que el usuario pueda usar.
describe("«no me cabe la conversación entera» tiene texto en los diez", () => {
  it.each(LOCALES)("%s", (loc) => {
    const agente = JSON.parse(
      readFileSync(join(process.cwd(), "messages", loc, "wsPage.json"), "utf-8"),
    ).agent as { ventana?: string };
    expect(agente.ventana, `sin traducir en ${loc}`).toBeTruthy();
    expect(agente.ventana, `sin {visibles} en ${loc}`).toContain("{visibles}");
    expect(agente.ventana, `sin {totales} en ${loc}`).toContain("{totales}");
  });
});

// ─── Y QUE LA FRASE LLEGUE AL DOM, no sólo a una función ────────────────────
//
// 🔴 Una cobertura que se calcula y no se pinta es el velo que nunca se pintó:
// verde en la unidad y nada que leer en la pantalla. `coberturaTitle` podría
// devolver la frase perfecta y la tarjeta no ponerla, y las pruebas de arriba
// seguirían pasando. Esto renderiza la tarjeta de verdad y mira el atributo.
describe("la cobertura llega al DOM", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  const pintar = (action: AgentAction): HTMLElement => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(createElement(AgentActionCard, { action }));
    });
    return host.firstElementChild as HTMLElement;
  };

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("la tarjeta de «miró y está bien» lleva el title con la cobertura", () => {
    const el = pintar(action("verificar_diseno", "ok"));
    expect(el.getAttribute("title")).toBe("agent.action.visualCobertura");
    expect(el.textContent).toContain("agent.action.visualOk");
  });

  it("y la de «no midió» lleva la SUYA, que dice otra cosa", () => {
    const el = pintar(action("verificar_diseno", "ok-sin-medida"));
    expect(el.getAttribute("title")).toBe("agent.action.visualCoberturaSinMedida");
  });

  // CONTRA-PRUEBA: donde no hay cobertura que contar, no se inventa un title
  // vacío —que en un navegador pinta un tooltip en blanco al pasar por encima.
  it("CONTRA-PRUEBA: sin cobertura, la tarjeta no lleva title", () => {
    expect(pintar(action("verificar_diseno", "no-mirado")).hasAttribute("title")).toBe(false);
    expect(pintar(action("editar_texto", "hero")).hasAttribute("title")).toBe(false);
  });
});
