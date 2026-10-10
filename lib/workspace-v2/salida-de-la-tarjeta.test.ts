import { describe, expect, it } from "vitest";

import { resumenDelComando } from "@/lib/agent/terminal/resumen-del-comando";
import { cabezaYCola, LINEAS_EN_LA_LENTE, LINEAS_PLEGADAS, plegarSalida, salidaDelComando } from "./salida-de-la-tarjeta";

const c = (command: string, salida: string | null = `${command}\n[Command finished with exit code 0]`) => ({
  command,
  salida,
  exitCode: 0,
});

describe("salidaDelComando — cada tarjeta de bash con SU salida", () => {
  const turno = [c("grep -rn Marea /"), c("sed -i 's/a/b/' /index.html"), c("grep -rn Marea /")];

  it("por orden, cuando el resumen cuadra", () => {
    expect(salidaDelComando(turno, 1, resumenDelComando("sed -i 's/a/b/' /index.html"))).toBe(turno[1]);
    expect(salidaDelComando(turno, 2, resumenDelComando("grep -rn Marea /"))).toBe(turno[2]);
  });

  it("si el orden no cuadra, el del mismo resumen MÁS CERCANO a esa posición", () => {
    // Una llamada sin comando no deja salida: la tarjeta 3 cae donde está el 2.
    expect(salidaDelComando(turno, 3, resumenDelComando("grep -rn Marea /"))).toBe(turno[2]);
    expect(salidaDelComando(turno, 0, resumenDelComando("sed -i 's/a/b/' /index.html"))).toBe(turno[1]);
  });

  it("sin ninguno con ese resumen, nada (no se enseña la salida de otro)", () => {
    expect(salidaDelComando(turno, 0, "cat /index.html")).toBeNull();
    expect(salidaDelComando([], 0, "ls")).toBeNull();
  });

  it("un comando largo casa por su resumen de 60, que es lo que guarda la tarjeta", () => {
    const largo = `cat > /datos/precios.json <<'EOF'\n${"[".padEnd(400, " ")}]\nEOF`;
    expect(salidaDelComando([c(largo)], 0, resumenDelComando(largo))?.command).toBe(largo);
  });
});

describe("plegarSalida — las tres líneas de Claude Code y lo que queda", () => {
  it("quita la línea de DeepSeek: el código va aparte", () => {
    const p = plegarSalida("a\nb\n[Command finished with exit code 0]");
    expect(p.lineas).toEqual(["a", "b"]);
    expect(p.hayMas).toBe(false);
  });

  it(`enseña ${LINEAS_PLEGADAS} y cuenta las demás`, () => {
    const p = plegarSalida(["1", "2", "3", "4", "5", "[Command finished with exit code 2]"].join("\n"));
    expect(p.cabeza).toEqual(["1", "2", "3"]);
    expect(p.resto).toBe(2);
    expect(p.hayMas).toBe(true);
  });

  it("pocas líneas pero muy largas también se despliegan (un HTML en una línea)", () => {
    const p = plegarSalida(`${"<div>".repeat(80)}\n[Command finished with exit code 0]`);
    expect(p.resto).toBe(0);
    expect(p.hayMas).toBe(true);
  });

  it("sin nada impreso, ninguna línea", () => {
    expect(plegarSalida("[Command finished with exit code 0]").lineas).toEqual([]);
  });

  it("🔴 la salida como el Bash de Claude Code: fuera el «Exit code N» de arriba y el «sin salida» (la tarjeta pinta el código aparte)", () => {
    expect(plegarSalida("Exit code 2\nbash: x: command not found").lineas).toEqual(["bash: x: command not found"]);
    expect(plegarSalida("(bash completed with no output)").lineas).toEqual([]);
    expect(plegarSalida("Exit code 1").lineas).toEqual([]);
    expect(plegarSalida("").lineas).toEqual([]);
  });
});

describe("cabezaYCola — el plegado de la lente, como el bloque de terminal de DeepSeek", () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => String(i + 1));

  it("hasta el tope, todo y nada oculto", () => {
    expect(cabezaYCola(n(LINEAS_EN_LA_LENTE))).toEqual({ cabeza: n(LINEAS_EN_LA_LENTE), ocultas: 0, cola: [] });
    expect(cabezaYCola([])).toEqual({ cabeza: [], ocultas: 0, cola: [] });
  });

  it("por encima, la mitad arriba, la mitad abajo y cuántas faltan en medio", () => {
    const p = cabezaYCola(n(30));
    expect(p.cabeza).toEqual(n(8));
    expect(p.ocultas).toBe(14);
    expect(p.cola).toEqual(["23", "24", "25", "26", "27", "28", "29", "30"]);
  });

  it("con un tope impar, la de arriba se lleva la sobrante", () => {
    const p = cabezaYCola(n(10), 5);
    expect(p.cabeza).toEqual(["1", "2", "3"]);
    expect(p.cola).toEqual(["9", "10"]);
    expect(p.ocultas).toBe(5);
  });
});

describe("resumenDelComando", () => {
  it("una línea, como mucho 60 y «…»", () => {
    expect(resumenDelComando("  grep   -rn\n Marea /  ")).toBe("grep -rn Marea /");
    expect(resumenDelComando("x".repeat(61))).toBe(`${"x".repeat(60)}…`);
    expect(resumenDelComando("x".repeat(60))).toBe("x".repeat(60));
  });
});
