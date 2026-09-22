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

  it("y la tarjeta lo PINTA en rojo y en ámbar, nunca en verde", () => {
    const card = lee("components", "workspace-v2", "agent-action-card.tsx");
    expect(card).toMatch(/action\.status === "error" \|\| action\.status === "warning"/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EL ÁMBAR CRUZA LOS MISMOS ESLABONES (2026-09-18).
  //
  // Un aviso sobre una edición que SÍ se guardó no es un fallo, así que no
  // pasa por el camino del rojo. Tiene el suyo, y se rompería igual de
  // callado: la herramienta lo pone en la respuesta, el bucle lo traduce a
  // `warning`, y la tarjeta lo pinta. (Nació para la prueba descartada, que
  // desde el 2026-09-22 rechaza la llamada entera: ésa ya va por el rojo.)
  it("el bucle traduce el aviso a ÁMBAR, no a verde ni a rojo", () => {
    const loop = lee("lib", "agent", "loop.ts");
    expect(loop).toContain("avisoParaElDueno");
    expect(loop).toMatch(/status: ok \? \(descartada \? "warning" : "done"\) : "error"/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 🔴 Y NO SÓLO ESA BANDERA (2026-09-21).
  //
  // El eslabón de arriba es el de UNA clave. Contadas sobre `tools.ts` hay 13
  // señales de avería en `extra.*`, y el bucle leía una. Las otras doce vivían
  // en `aviso_critico`, cuyo único consumidor era el modelo — o sea que el
  // dueño se enteraba sólo si Len se acordaba de contárselo en su prosa.
  //
  // Esto sujeta la forma de Claude Code: UN SOLO CANAL. Lo que el modelo lee
  // es lo que se enseña, sin una segunda ruta con lista blanca de la que un
  // hecho pueda caerse.
  it("🔴 y CUALQUIER aviso_critico llega a la tarjeta, no sólo la prueba", () => {
    const motivo = lee("lib", "agent", "motivo-del-fallo.ts");
    expect(motivo).toContain("respuesta.aviso_critico");
  });

  // El rechazo se CUENTA llamada a llamada: la herramienta lo deja en la sesión
  // y el arnés lo anota en cada entrada (`rechazo`), así que «se arregló en la
  // siguiente» se lee de la secuencia. Hasta el 2026-09-22 lo llevaba además un
  // contador propio del DSL (`seguimientoDelRechazo`), que se fue con él.
  it("y el rechazo se CUENTA, llamada a llamada", () => {
    const tools = lee("lib", "agent", "tools.ts");
    expect(tools).toContain("session.rechazoPrueba = js.reason");
    const arnes = lee("lib", "agent", "evals", "promesas.ts");
    expect(arnes).toContain("rechazo: session.rechazoPrueba");
  });
});
