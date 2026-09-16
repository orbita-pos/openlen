// NADA SE PIERDE EN LA MUDANZA.
//
// 🔴 YA MORDIÓ UNA VEZ. El plan del 2026-08-29 quiso borrar `modules-panel.tsx`
// entero; de sus 1.171 líneas sólo 57 eran del módulo que se retiraba, y dentro
// vivían los ajustes del CHAT, «que NO SE ALCANZAN POR NINGÚN OTRO SITIO».
// Lo salvó medir antes de borrar. Esta prueba es esa medición, clavada: si la
// demolición se lleva un campo por delante, sale roja y lo nombra.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");

/** Los campos de chat que el dueño puede configurar HOY. Salen del validador
 *  del embudo (`lib/projects/settings-patch.ts`), que es la fuente. */
const CAMPOS_DE_CHAT = [
  "enabled",
  "selfServeJoin",
  "mount",
  "identityMode",
  "welcome",
  "theme",
  "quickReplies",
] as const;

const CAMPOS_DE_ASISTENTE = ["enabled", "facts", "tone"] as const;

describe("la mudanza no pierde campos", () => {
  const chat = readFileSync(join(RAIZ, "components", "inbox", "ajustes-del-chat.tsx"), "utf8");
  const asistente = readFileSync(
    join(RAIZ, "components", "inbox", "ajustes-del-asistente.tsx"),
    "utf8",
  );

  it("🔴 los siete campos de chat siguen siendo configurables", () => {
    const faltan = CAMPOS_DE_CHAT.filter((c) => !chat.includes(c));
    expect(
      faltan,
      `la mudanza se dejó campos del chat por el camino: ${faltan.join(", ")}`,
    ).toEqual([]);
  });

  it("🔴 los tres del asistente también", () => {
    const faltan = CAMPOS_DE_ASISTENTE.filter((c) => !asistente.includes(c));
    expect(faltan, `faltan del asistente: ${faltan.join(", ")}`).toEqual([]);
  });

  it("🔴 EL EQUIPO del chat también se muda — no es un campo de settings y la lista de arriba no lo ve", () => {
    // Invitar compañeros a atender el chat vivía SÓLO en `AgentsList`, dentro
    // de modules-panel.tsx. Sin esta línea la demolición se lo llevaba entero.
    expect(chat, "falta la lista del equipo (GET/POST /agents)").toMatch(/\/agents`/);
    expect(chat, "falta quitar a un compañero (DELETE /agents/:id)").toMatch(/\/agents\/\$\{/);
  });

  it("BRAZO DE CONTROL: la sonda leyó ficheros de verdad", () => {
    expect(chat.length).toBeGreaterThan(500);
    expect(asistente.length).toBeGreaterThan(500);
  });
});
