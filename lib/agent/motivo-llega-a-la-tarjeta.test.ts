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
import { crearRegistroDelTurno } from "./registro-del-turno";

const lee = (...partes: string[]) => readFileSync(join(process.cwd(), ...partes), "utf8");

// 🔴 N41 (03/10): el `motivo` de una tarjeta ROJA ya no es el texto que leyó el
// modelo —en inglés y escrito para Len—, sino `ownerReason`: un código que el
// chat traduce. El `motivo` sigue viajando para lo que SÍ se escribe para el
// dueño (las tarjetas de los ojos), así que sus eslabones 2–5 se quedan.
describe("el motivo del DUEÑO cruza los cinco eslabones (N41)", () => {
  it("1 · el bucle lo EMITE con la tarjeta, declarado en el tipo del evento", () => {
    const loop = lee("lib", "agent", "loop.ts");
    expect(loop).toMatch(/ownerReason\?: OwnerReason;/);
    expect(loop).toMatch(/outcome\.ownerReason/);
    // Y lo que leyó el modelo NO sale por la tarjeta.
    expect(loop).not.toMatch(/motivoDelFallo\(/);
  });

  it("2 · el chat lo LEE del evento por la puerta que valida el código", () => {
    const panel = lee("components", "workspace-v2", "chat", "use-agent-chat.ts");
    expect(panel).toMatch(/ownerReasonFrom\(/);
  });

  it("3 · el servidor lo copia a la tarjeta que PERSISTE él", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "publish", status: "error", summary: "x", ownerReason: { code: "address_needed" } });
    r.observar({ type: "action", tool: "publish", status: "error", summary: "y" });
    expect(r.tarjetas[0]).toMatchObject({ ownerReason: { code: "address_needed" } });
    // BRAZO DE CONTROL: la tarjeta sin motivo no se inventa uno.
    expect(r.tarjetas[1]).not.toHaveProperty("ownerReason");
  });

  it("4 · el esquema del historial lo ACEPTA en vez de tirar el turno", () => {
    const chat = lee("app", "api", "projects", "[id]", "chat", "route.ts");
    expect(chat).toMatch(/ownerReason: z/);
  });

  it("5 · la forma guardada lo DECLARA, o se pierde al reconstruir el turno", () => {
    const tipos = lee("lib", "projects", "types.ts");
    const actions = tipos.slice(tipos.indexOf("actions?: Array<{"));
    expect(actions.slice(0, 3000)).toMatch(/ownerReason\?: OwnerReason;/);
  });

  // La regla de qué se pinta vive en UNA función (`reasonLine`, probada en
  // agent-action-card.test.ts); aquí sólo se sujeta que las dos tarjetas la usan.
  it("y las dos tarjetas (chat nuevo y viejo) lo PINTAN por la misma regla", () => {
    expect(lee("components", "workspace-v2", "chat", "steps-card.tsx")).toMatch(/reasonLine\(action, t\)/);
    expect(lee("components", "workspace-v2", "agent-action-card.tsx")).toMatch(/reasonLine\(action, t\)/);
  });
});

// El `motivo` que queda es el de las tarjetas ÁMBAR de los ojos (la regresión,
// la lista medida), escrito para el dueño.
describe("el motivo del ámbar cruza los mismos eslabones", () => {

  it("2 · el panel lo LEE del evento y lo cuelga de la tarjeta", () => {
    // La lectura del stream vive en la lógica que comparten los dos chats.
    const panel = lee("components", "workspace-v2", "chat", "use-agent-chat.ts");
    expect(panel).toMatch(/motivo\?: unknown/);
    expect(panel).toMatch(/\{ motivo: motivo\.slice/);
  });

  it("3 · el servidor lo copia a la tarjeta que PERSISTE él", () => {
    // El navegador no es el único que escribe la transcripción: si el socket
    // muere, la escribe la ruta. Sin esta línea, un turno guardado por el
    // servidor pierde el motivo — justo el turno que peor acabó.
    //
    // Desde H05 (2026-09-22) la ruta no copia las tarjetas ella misma: se las
    // pasa a `registro-del-turno.ts`, que es puro, así que este eslabón se
    // prueba por lo que HACE y el código fuente sólo se mira para el cableado.
    const ruta = lee("app", "api", "agent", "route.ts");
    expect(ruta).toMatch(/crearRegistroDelTurno\(\)/);
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "verificar_diseno", status: "warning", summary: "x", motivo: "sin id" });
    r.observar({ type: "action", tool: "editar_html", status: "done", summary: "y" });
    expect(r.tarjetas[0]).toMatchObject({ motivo: "sin id" });
    // BRAZO DE CONTROL: la tarjeta sin motivo no se inventa uno.
    expect(r.tarjetas[1]).not.toHaveProperty("motivo");
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

  // 🔴 SÓLO EN ÁMBAR (N41). Un `motivo` en una tarjeta ROJA es el texto que
  // leyó el modelo —las filas guardadas antes del 03/10 lo traen—, y no se
  // pinta: la roja dice su `ownerReason` o «No pudo». Lo prueba `reasonLine`
  // en agent-action-card.test.ts.

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
    // Lote 7-8: una pregunta DESCARTADA para hablar tampoco es roja (DeepSeek
    // pinta su `ASK_CANCELLED` como `ok`), aunque el modelo lea un error.
    expect(loop).toMatch(/status: ok \|\| outcome\.dismissed \? \(descartada \? "warning" : "done"\) : "error"/);
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

  // ⚰️ «y el rechazo se CUENTA, llamada a llamada» sujetaba el rechazo de
  // `prueba_js`, que se fue con `editar_runtime` en Len 2.0: Claude Code no
  // tiene nada así, y el JavaScript se edita como cualquier trozo del fichero.
});
