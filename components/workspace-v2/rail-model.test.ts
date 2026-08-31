import { describe, expect, it } from "vitest";
import { RAIL_CREAR, RAIL_OPERAR } from "./rail-model";

// LÁPIDA del 2026-08-29. El hub de Módulos sale del rail.
//
// No era una pestaña mal colocada: el rail es una INVITACIÓN, y la suya era a
// ir a activar cosas — el gesto que sobra. Una página con un catálogo ES un
// catálogo; pedirle al dueño que vaya a un hub a encenderlo es pedirle que
// entienda nuestra arquitectura.
//
// La VISTA sigue existiendo por URL (`?view=modulos`) a propósito, y esto no es
// una concesión: dentro viven todavía la configuración del Chat y la de
// Plataformas, y la del Chat NO SE ALCANZA POR NINGÚN OTRO SITIO —el panel
// `chat` del rail es la conversación con Len, otra cosa—. Mudarlas a Business
// es una migración de interfaz de 846 líneas, no un barrido, y merece su propia
// tarea. Lo que sí murió del todo es Colecciones.
describe("el rail no tiene hub de Módulos", () => {
  const items = [...RAIL_CREAR, ...RAIL_OPERAR];

  it("ninguna entrada apunta a la vista «modulos»", () => {
    const vistas = items
      .filter((i) => i.kind === "view")
      .map((i) => (i as { view: string }).view);
    expect(vistas).not.toContain("modulos");
  });

  it("ni al panel de colecciones ni al de módulos", () => {
    const paneles = items
      .filter((i) => i.kind === "panel")
      .map((i) => (i as { id: string }).id);
    expect(paneles).not.toContain("collections");
    expect(paneles).not.toContain("modulos");
  });

  // «Mi negocio» se fue el 2026-08-31 con el perfil entero: era la Única vista
  // del rail que pedía RELLENAR una ficha en vez de mirar la página.
  it("ni a la sección de negocio, que ya no existe", () => {
    const vistas = items
      .filter((i) => i.kind === "view")
      .map((i) => (i as { view: string }).view);
    expect(vistas).not.toContain("business");
  });

  // El rail sigue siendo un rail: si el barrido se llevara algo de más, esto lo
  // dice antes que un ojo.
  it("y sigue teniendo lo que sí existe", () => {
    const vistas = items
      .filter((i) => i.kind === "view")
      .map((i) => (i as { view: string }).view);
    // ⚰️ `business` estaba en esta lista hasta el 2026-08-31, y esta prueba
    // fue lo primero que se quejó al retirarlo — que es justo para lo que
    // está. Pasa a la de abajo.
    expect(vistas).toContain("resultados");
    const paneles = items
      .filter((i) => i.kind === "panel")
      .map((i) => (i as { id: string }).id);
    expect(paneles).toContain("chat");
  });
});
