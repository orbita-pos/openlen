import { describe, expect, it, vi } from "vitest";

import {
  MAX_COMENTARIOS,
  MAX_PROMPT,
  MAX_TEXTO_ESCRITO,
  createComentariosDelChat,
  textoConComentarios,
  type ComentarioDeLinea,
} from "./comentarios-de-lineas";

const E = { titulo: "Comentarios en el código", deAntes: "antes del turno" };
const c = (o: Partial<ComentarioDeLinea>): ComentarioDeLinea => ({
  id: 1,
  ruta: "/contacto/index.html",
  linea: 16,
  codigo: "  <address>Calle Marea 12</address>",
  texto: "pon la nueva dirección",
  ...o,
});

describe("textoConComentarios — los comentarios, dentro de tu mensaje (la #8)", () => {
  it("sin comentarios, tu texto tal cual", () => {
    expect(textoConComentarios("hola", [], E)).toBe("hola");
  });

  it("cada uno con su fichero:línea, el código de esa línea y lo que dijiste", () => {
    expect(textoConComentarios("cambia el color", [c({})], E)).toBe(
      "cambia el color\n\nComentarios en el código:\n- `contacto/index.html:16` `<address>Calle Marea 12</address>` — pon la nueva dirección",
    );
  });

  it("sólo comentarios, sin texto; y la línea quitada dice que es de antes", () => {
    expect(textoConComentarios("  ", [c({ deAntes: true })], E)).toBe(
      "Comentarios en el código:\n- `contacto/index.html:16` (antes del turno) `<address>Calle Marea 12</address>` — pon la nueva dirección",
    );
  });

  it("una línea con comillas de código no rompe la cita, y una larga se corta", () => {
    expect(textoConComentarios("", [c({ codigo: "const a = `x`;" })], E)).toContain("`` const a = `x`; ``");
    expect(textoConComentarios("", [c({ codigo: "a".repeat(500) })], E)).toContain(`${"a".repeat(160)}…`);
  });

  it("🔴 cabe siempre en lo que acepta el servidor", () => {
    const muchos = Array.from({ length: 30 }, (_, i) =>
      c({ id: i, ruta: `/${"r".repeat(100)}/index.html`, codigo: "x".repeat(1000), texto: "y".repeat(2000) }),
    );
    expect(textoConComentarios("z".repeat(MAX_TEXTO_ESCRITO), muchos, E).length).toBeLessThanOrEqual(MAX_PROMPT);
  });
});

describe("la cola de comentarios del chat", () => {
  it("añade, quita y vacía por proyecto, y avisa", () => {
    const cola = createComentariosDelChat();
    const aviso = vi.fn();
    cola.subscribe(aviso);
    const a = cola.anadir("p", { ruta: "/index.html", linea: 3, codigo: "<h1>", texto: " otro título " })!;
    expect(a.texto).toBe("otro título");
    cola.anadir("q", { ruta: "/index.html", linea: 1, codigo: "", texto: "x" });
    expect(cola.lista("p")).toHaveLength(1);
    const antes = cola.lista("p");
    expect(cola.lista("p")).toBe(antes);
    cola.quitar("p", a.id);
    expect(cola.lista("p")).toHaveLength(0);
    cola.vaciar("q");
    expect(cola.lista("q")).toHaveLength(0);
    expect(aviso).toHaveBeenCalledTimes(4);
  });

  it("un comentario vacío no entra, y hay tope", () => {
    const cola = createComentariosDelChat();
    expect(cola.anadir("p", { ruta: "/a", linea: 1, codigo: "", texto: "   " })).toBeNull();
    for (let i = 0; i < MAX_COMENTARIOS; i++) cola.anadir("p", { ruta: "/a", linea: i + 1, codigo: "", texto: "x" });
    expect(cola.anadir("p", { ruta: "/a", linea: 99, codigo: "", texto: "x" })).toBeNull();
  });
});
