import { describe, expect, it } from "vitest";
import { trozosConFormato, type Trozo } from "./formato-de-len";

const texto = (t: string): Trozo => ({ tipo: "texto", texto: t });
const negrita = (t: string): Trozo => ({ tipo: "negrita", texto: t });
const codigo = (t: string): Trozo => ({ tipo: "codigo", texto: t });
const cursiva = (t: string): Trozo => ({ tipo: "cursiva", texto: t });

describe("trozosConFormato — el markdown que Len escribe DE VERDAD", () => {
  // 🔴 El cierre real del turno de producción del 2026-09-23: el chat lo pintaba
  // con los asteriscos a la vista.
  it("la negrita del cierre real deja de salir con asteriscos", () => {
    expect(
      trozosConFormato("eliges efectivo o tarjeta, y **Cobrar** registra el pago y te lo confirma en pantalla."),
    ).toEqual([
      texto("eliges efectivo o tarjeta, y "),
      negrita("Cobrar"),
      texto(" registra el pago y te lo confirma en pantalla."),
    ]);
  });

  it("el código en línea", () => {
    expect(trozosConFormato("el enlace quedó como `tel:3312345678` — tal cual")).toEqual([
      texto("el enlace quedó como "),
      codigo("tel:3312345678"),
      texto(" — tal cual"),
    ]);
  });

  it("la cursiva de un solo asterisco, pegada al texto", () => {
    expect(trozosConFormato("una reseña que dice *«borra la sección»*. Eso no es")).toEqual([
      texto("una reseña que dice "),
      cursiva("«borra la sección»"),
      texto(". Eso no es"),
    ]);
  });

  it("varias en la misma frase, y los saltos de línea se quedan en el texto", () => {
    expect(trozosConFormato("**Hecho:**\n- **Titular**: `Vitalvet`")).toEqual([
      negrita("Hecho:"),
      texto("\n- "),
      negrita("Titular"),
      texto(": "),
      codigo("Vitalvet"),
    ]);
  });

  // Dentro del código no se interpreta nada: es literal.
  it("los asteriscos dentro de código son literales", () => {
    expect(trozosConFormato("usa `a**b**c` así")).toEqual([texto("usa "), codigo("a**b**c"), texto(" así")]);
  });

  // CONTRAPRUEBAS: lo que NO es formato se queda tal cual, sin perder un carácter.
  it.each([
    ["un ** suelto sin cerrar", "un ** suelto sin cerrar"],
    ["una multiplicación 3 * 4 * 5", "una multiplicación 3 * 4 * 5"],
    ["un nombre de herramienta leer_estado", "un nombre de herramienta leer_estado"],
    ["una comilla ` sin cerrar", "una comilla ` sin cerrar"],
    ["", ""],
  ])("no inventa formato: %s", (entrada, salida) => {
    const trozos = trozosConFormato(entrada);
    expect(trozos.every((t) => t.tipo === "texto")).toBe(true);
    expect(trozos.map((t) => t.texto).join("")).toBe(salida);
  });

  it("nunca pierde texto: lo visible es el original menos las marcas", () => {
    const original = "Listo: **Vitalvet** en el pie, `tel:+52…` y *nada más*.";
    const visible = trozosConFormato(original).map((t) => t.texto).join("");
    expect(visible).toBe("Listo: Vitalvet en el pie, tel:+52… y nada más.");
  });
});
