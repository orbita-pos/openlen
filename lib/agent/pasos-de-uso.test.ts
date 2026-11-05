// La entrada de `use_page` se comprueba ANTES de abrir el navegador: una
// llamada que no valida no corre ni un paso (el orden del ejecutor de Claude
// Code). Cada rechazo dice qué cambiar.
import { describe, expect, it } from "vitest";

import { MAX_EVAL_CHARS, MAX_PASOS, MAX_SCREENSHOTS_PER_VISIT, parseKey, validarPasos } from "./pasos-de-uso";

const error = (bruto: unknown) => {
  const r = validarPasos(bruto);
  if (r.ok) throw new Error("tenía que rechazarse");
  return r.error;
};

describe("validarPasos", () => {
  it("acepta los cinco verbos y within con click y choose", () => {
    const r = validarPasos([
      { click: "Agregar", within: "Vela" },
      { type: "3", into: "Metros" },
      { choose: "Nogal" },
      { reload: true },
      { read: "Total" },
    ]);
    expect(r).toEqual({
      ok: true,
      pasos: [{ click: "Agregar", within: "Vela" }, { type: "3", into: "Metros" }, { choose: "Nogal" }, { reload: true }, { read: "Total" }],
    });
  });

  it("type puede teclear un texto vacío (vaciar un campo) pero necesita into", () => {
    expect(validarPasos([{ type: "", into: "Código" }]).ok).toBe(true);
    expect(error([{ type: "hola" }])).toContain("needs `into`");
  });

  it("rechaza una lista vacía, o que no es lista, o demasiado larga", () => {
    expect(error([])).toContain("at least one step");
    expect(error("click Agregar")).toContain("at least one step");
    expect(error(Array.from({ length: MAX_PASOS + 1 }, () => ({ read: "x" })))).toContain("Split it into two visits");
  });

  it("un paso hace UNA cosa, y lo dice por su número", () => {
    expect(error([{ read: "Total" }, { click: "A", read: "B" }])).toContain("Step 2 carries `click` and `read`");
    expect(error([{}])).toContain("doesn't say what to do");
  });

  it("un parámetro inesperado se nombra (como Claude Code)", () => {
    expect(error([{ click: "A", selector: "#a" }])).toContain("unexpected parameter `selector`");
  });

  it("into y within sólo donde tienen sentido; reload es true", () => {
    expect(error([{ click: "A", into: "B" }])).toContain("`into` only goes with `type`");
    expect(error([{ read: "A", within: "B" }])).toContain("`within` only goes with `click` or `choose`");
    expect(error([{ reload: "sí" }])).toContain('{"reload": true}');
  });

  it("un texto vacío o demasiado largo no vale", () => {
    expect(error([{ click: "   " }])).toContain("`click` has to be a text");
    expect(error([{ read: "x".repeat(201) }])).toContain("`read` has to be a text");
  });

  // Los ojos como Claude Code (14/10): la captura es un paso de la visita, tras
  // los clics, y `eval` inspecciona lo que no se lee (un canvas, el estado de un
  // juego) sin tocar el código de la app.
  it("🔴 screenshot («screen» o el texto de un bloque) y eval son pasos", () => {
    expect(validarPasos([{ click: "Play" }, { screenshot: "screen" }, { screenshot: "Pricing" }, { eval: "document.title" }])).toEqual({
      ok: true,
      pasos: [{ click: "Play" }, { screenshot: "screen" }, { screenshot: "Pricing" }, { eval: "document.title" }],
    });
  });

  it("eval admite código largo, pero tiene techo; screenshot, el de un texto", () => {
    expect(validarPasos([{ eval: "const c = document.querySelector('canvas');\n" + "x".repeat(1500) }]).ok).toBe(true);
    expect(error([{ eval: "x".repeat(MAX_EVAL_CHARS + 1) }])).toContain(`\`eval\` has to be JavaScript of up to ${MAX_EVAL_CHARS} characters`);
    expect(error([{ screenshot: "" }])).toContain("`screenshot` has to be a text");
  });

  it("como mucho tres capturas por visita", () => {
    const shots = Array.from({ length: MAX_SCREENSHOTS_PER_VISIT + 1 }, () => ({ screenshot: "screen" }));
    expect(error(shots)).toContain(`at most ${MAX_SCREENSHOTS_PER_VISIT} screenshots`);
  });

  it("la lista de verbos del error nombra los nuevos", () => {
    expect(error([{}])).toContain("screenshot");
    expect(error([{}])).toContain("eval");
  });
});

// LOS PASOS DE CLAUDE CODE (spec local 2026-11-05-ojos-que-ven-el-movimiento, §8.5): las acciones de su
// herramienta `computer` del navegador, con sus nombres: key (+ repeat), wait, left_click, hover,
// left_click_drag (+ coordinate) y zoom. Coordenadas = píxeles de la pestaña.
describe("validarPasos — los pasos de Claude Code", () => {
  it("🔴 acepta key, wait, left_click, hover, left_click_drag y zoom", () => {
    const pasos = [
      { key: "ctrl+k" },
      { key: "ArrowLeft", repeat: 3 },
      { wait: 2 },
      { left_click: [640, 360] },
      { hover: [10, 20] },
      { left_click_drag: [100, 200], coordinate: [400, 200] },
      { zoom: [0, 0, 320, 240] },
    ];
    expect(validarPasos(pasos)).toEqual({ ok: true, pasos });
  });

  it("parseKey traduce nombres y combinaciones a teclas de Puppeteer", () => {
    expect(parseKey("ctrl+k")).toEqual({ ok: true, combos: [["Control", "k"]] });
    expect(parseKey("Return")).toEqual({ ok: true, combos: [["Enter"]] });
    expect(parseKey("up")).toEqual({ ok: true, combos: [["ArrowUp"]] });
    expect(parseKey("cmd+shift+Z")).toEqual({ ok: true, combos: [["Meta", "Shift", "Z"]] });
    expect(parseKey("space")).toEqual({ ok: true, combos: [["Space"]] });
    expect(parseKey("F5")).toEqual({ ok: true, combos: [["F5"]] });
  });

  // Claude Code's key: «space-separated keys (e.g. "Backspace Backspace Delete")».
  it("parseKey acepta varias teclas separadas por espacios, como el key de Claude Code", () => {
    expect(parseKey("Backspace Backspace Delete")).toEqual({ ok: true, combos: [["Backspace"], ["Backspace"], ["Delete"]] });
    expect(parseKey("ctrl+a Delete")).toEqual({ ok: true, combos: [["Control", "a"], ["Delete"]] });
    expect(parseKey("é")).toEqual({ ok: true, combos: [["é"]] });
  });

  it("una tecla que no existe se rechaza antes de abrir nada, con ejemplos", () => {
    const e = error([{ key: "Enterr" }]);
    expect(e).toContain('"Enter"');
    expect(e).toContain('"ArrowLeft"');
    expect(error([{ key: "k+ctrl" }])).toContain("isn't a key");
  });

  it("wait es de más de 0 a 10 segundos", () => {
    expect(error([{ wait: 0 }])).toContain("up to 10");
    expect(error([{ wait: 11 }])).toContain("up to 10");
    expect(error([{ wait: "2" }])).toContain("up to 10");
  });

  it("las coordenadas son dos números de 0 o más; zoom, cuatro, con el final después del principio", () => {
    expect(error([{ left_click: [1] }])).toContain("Step 1: `left_click`");
    expect(error([{ hover: ["a", 2] }])).toContain("Step 1: `hover`");
    expect(error([{ left_click: [-5, 3] }])).toContain("Step 1: `left_click`");
    expect(error([{ zoom: [10, 10, 5, 20] }])).toContain("Step 1: `zoom`");
  });

  it("coordinate sólo con left_click_drag, que lo necesita; repeat sólo con key, de 1 a 100", () => {
    expect(error([{ left_click: [1, 1], coordinate: [2, 2] }])).toContain("`coordinate` only goes with `left_click_drag`");
    expect(error([{ left_click_drag: [1, 1] }])).toContain("needs `coordinate`");
    expect(error([{ wait: 1, repeat: 2 }])).toContain("`repeat` only goes with `key`");
    expect(error([{ key: "a", repeat: 0 }])).toContain("from 1 to 100");
  });

  it("zoom cuenta como captura: tres capturas y un zoom son demasiadas", () => {
    expect(error([{ screenshot: "screen" }, { screenshot: "screen" }, { screenshot: "screen" }, { zoom: [0, 0, 10, 10] }])).toContain(
      `at most ${MAX_SCREENSHOTS_PER_VISIT} screenshots`,
    );
  });
});
