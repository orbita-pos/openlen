// NADA SE PIERDE EN LA MUDANZA.
//
// 🔴 YA MORDIÓ UNA VEZ. El plan del 2026-08-29 quiso borrar `modules-panel.tsx`
// entero; de sus 1.171 líneas sólo 57 eran del módulo que se retiraba, y dentro
// vivían los ajustes del CHAT, «que NO SE ALCANZAN POR NINGÚN OTRO SITIO».
// Lo salvó medir antes de borrar. Esta prueba es esa medición, clavada: si la
// demolición se lleva un campo por delante, sale roja y lo nombra.
//
// 🔴 SEGUNDA MORDIDA, esta vez de la propia prueba: comparaba con `includes()`
// sobre el fichero CRUDO, sin quitar comentarios. La cabecera de
// `ajustes-del-chat.tsx` NOMBRA los siete campos y el `/agents` del equipo — un
// revisor vació ese componente a `return null` dejando su cabecera, y las
// siete aserciones de campo, la del equipo y el brazo de control de 500
// caracteres siguieron en VERDE. Una lápida que nombra lo retirado no es lo
// retirado (`lib/sin-comentarios.ts`). Por eso cada lectura pasa primero por
// `sinComentarios`: sólo cuenta lo que queda si se borran los comentarios.
//
// Además cada campo se busca en SU fichero, no en los tres a la vez — buscarlo
// en cualquiera de los tres deja pasar una demolición que se lo llevó del
// fichero correcto porque el nombre sigue vivo, por casualidad, en otro:
//   enabled (chat Y asistente)                        → franja-de-estado.tsx,
//                                                          el interruptor
//   mount/selfServeJoin/identityMode/welcome/theme/
//   quickReplies                                       → ajustes-del-chat.tsx
//   el equipo (GET/POST/DELETE /agents)                → ajustes-del-chat.tsx
//   facts/tone                                         → ajustes-del-asistente.tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sinComentarios } from "@/lib/sin-comentarios";

const RAIZ = join(import.meta.dirname, "..", "..");

/** Los campos del detalle de chat que el dueño puede configurar HOY, salvo
 *  `enabled` (vive en la franja, no aquí — ver el reparto arriba). Los
 *  nombres son los de `ChatSettings`, en `lib/projects/settings-patch.ts`. */
const CAMPOS_DEL_DETALLE_DE_CHAT = [
  "selfServeJoin",
  "mount",
  "identityMode",
  "welcome",
  "theme",
  "quickReplies",
] as const;

/** Los del detalle de asistente, salvo `enabled` (misma razón). */
const CAMPOS_DEL_DETALLE_DE_ASISTENTE = ["facts", "tone"] as const;

describe("la mudanza no pierde campos", () => {
  const franja = sinComentarios(
    readFileSync(join(RAIZ, "components", "inbox", "franja-de-estado.tsx"), "utf8"),
  );
  const chat = sinComentarios(
    readFileSync(join(RAIZ, "components", "inbox", "ajustes-del-chat.tsx"), "utf8"),
  );
  const asistente = sinComentarios(
    readFileSync(join(RAIZ, "components", "inbox", "ajustes-del-asistente.tsx"), "utf8"),
  );

  it("🔴 los seis campos del detalle de chat siguen siendo configurables", () => {
    const faltan = CAMPOS_DEL_DETALLE_DE_CHAT.filter((c) => !chat.includes(c));
    expect(
      faltan,
      `la mudanza se dejó campos del chat por el camino: ${faltan.join(", ")}`,
    ).toEqual([]);
  });

  it("🔴 los dos del detalle de asistente también", () => {
    const faltan = CAMPOS_DEL_DETALLE_DE_ASISTENTE.filter((c) => !asistente.includes(c));
    expect(faltan, `faltan del asistente: ${faltan.join(", ")}`).toEqual([]);
  });

  it("🔴 `enabled` sigue vivo en la franja, para chat Y para asistente", () => {
    // Cuenta, no sólo presencia: el tipo del parche y el brazo que arma el
    // parche al pulsar nombran `enabled` una vez por cada lado (chat y
    // asistente) en cada uno de los dos sitios — cuatro apariciones de código
    // real. Un `includes()` a secas pasaría igual con un solo lado vivo.
    const veces = franja.match(/enabled/g)?.length ?? 0;
    expect(
      veces,
      `"enabled" aparece ${veces} veces en código real de la franja (se esperaban ≥ 4: el tipo del parche y los dos brazos — asistente y chat — al armarlo)`,
    ).toBeGreaterThanOrEqual(4);
  });

  it("🔴 EL EQUIPO del chat también se muda — no es un campo de settings y la lista de arriba no lo ve", () => {
    // Invitar compañeros a atender el chat vivía SÓLO en `AgentsList`, dentro
    // de modules-panel.tsx. Sin esta línea la demolición se lo llevaba entero.
    expect(chat, "falta la lista del equipo (GET/POST /agents)").toMatch(/\/agents`/);
    expect(chat, "falta quitar a un compañero (DELETE /agents/:id)").toMatch(/\/agents\/\$\{/);
  });

  it("BRAZO DE CONTROL: la sonda leyó ficheros de verdad, sin comentarios de sobra", () => {
    // El umbral es sobre el texto YA SIN COMENTARIOS: una cabecera de lápida
    // (~1.469 caracteres en ajustes-del-chat.tsx) ya no cuenta para esto, así
    // que un componente vaciado a `return null` cae por debajo y este brazo
    // se entera — antes no se enteraba.
    expect(franja.length).toBeGreaterThan(500);
    expect(chat.length).toBeGreaterThan(500);
    expect(asistente.length).toBeGreaterThan(500);
  });
});
