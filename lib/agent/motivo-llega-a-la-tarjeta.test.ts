// @vitest-environment node
//
// LOS CINCO ESLABONES QUE EL MOTIVO TIENE QUE CRUZAR.
//
// Un campo nuevo en una tarjeta atraviesa cinco ficheros, y el que se olvida no
// rompe nada: compila, las pruebas de al lado siguen verdes y el campo
// simplemente no aparece. Ya pasó dos veces en esta misma tarjeta —`ops` y
// `observacion` se pintaban en vivo y desaparecían al recargar—, y las dos se
// cazaron probándolo a mano en el navegador, no con los tipos.
//
// El tipo NO lo caza: `StoredChatTurn["actions"]` es una forma estructural
// aparte, así que un campo de más llega por spread sin que `tsc` diga nada y se
// pierde en cuanto alguien construya el objeto a mano.
//
// 🔴 Esto mira el CÓDIGO FUENTE a propósito. La alternativa —levantar la ruta,
// el SSE y React— probaría lo mismo por diez veces el precio, y lo que hay que
// impedir es que alguien quite un eslabón, no que el conjunto funcione hoy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lee = (...partes: string[]) => readFileSync(join(process.cwd(), ...partes), "utf8");

describe("el motivo del fallo cruza los cinco eslabones", () => {
  it("1 · el bucle lo EMITE con la tarjeta", () => {
    const loop = lee("lib", "agent", "loop.ts");
    expect(loop).toContain("motivoDelFallo");
    // En el tipo del evento, no sólo colado por el spread: un campo que viaja
    // sin estar declarado lo borra el primero que toque el emisor.
    expect(loop).toMatch(/motivo\?: string;/);
  });

  it("2 · el panel lo LEE del evento y lo cuelga de la tarjeta", () => {
    const panel = lee("components", "workspace-v2", "panels", "chat-panel.tsx");
    expect(panel).toMatch(/motivo\?: unknown/);
    expect(panel).toMatch(/\{ motivo: motivo\.slice/);
  });

  it("3 · el servidor lo copia a la tarjeta que PERSISTE él", () => {
    // El navegador no es el único que escribe la transcripción: si el socket
    // muere, la escribe la ruta. Sin esta línea, un turno guardado por el
    // servidor pierde el motivo — justo el turno que peor acabó.
    const ruta = lee("app", "api", "agent", "route.ts");
    expect(ruta).toMatch(/ev\.motivo \? \{ motivo: ev\.motivo \}/);
  });

  it("4 · el esquema del historial lo ACEPTA en vez de tirar el turno", () => {
    const chat = lee("app", "api", "projects", "[id]", "chat", "route.ts");
    expect(chat).toMatch(/motivo: z/);
    // Se trunca, no se rechaza: un motivo largo haría 400 a TODO el turno.
    expect(chat).toMatch(/motivo: z\s*\n?\s*\.string\(\)\s*\n?\s*\.transform/);
  });

  it("5 · la forma guardada lo DECLARA, o se pierde al reconstruir el turno", () => {
    const tipos = lee("lib", "projects", "types.ts");
    const actions = tipos.slice(tipos.indexOf("actions?: Array<{"));
    expect(actions.slice(0, 2000)).toMatch(/motivo\?: string;/);
  });

  it("y la tarjeta lo PINTA sólo cuando el estado es error", () => {
    const card = lee("components", "workspace-v2", "agent-action-card.tsx");
    expect(card).toMatch(/action\.status === "error" \? action\.motivo/);
  });
});
