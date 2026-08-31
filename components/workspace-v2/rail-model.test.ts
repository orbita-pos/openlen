import { describe, expect, it } from "vitest";
import { RAIL_CREAR, RAIL_OPERAR, railActiveKey } from "./rail-model";

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

// EL RAIL SE QUEDA SIN CASITA Y SIN BOTÓN DE PLEGAR (2026-08-31).
//
// Dos controles que existían por un gesto que ya estaba implicado en otro: la
// casita para volver al lienzo —que ahora hace cualquier panel, porque Chat y
// Versiones actúan SOBRE la página— y el plegador, que hace el propio icono
// del panel abierto al pulsarlo otra vez.
describe("el rail no tiene casita", () => {
  const items = [...RAIL_CREAR, ...RAIL_OPERAR];

  it("ninguna entrada es una ACCIÓN: sólo paneles y vistas", () => {
    const clases = new Set(items.map((i) => i.kind));
    expect([...clases].sort()).toEqual(["panel", "view"]);
  });
});

// LA MITAD VISIBLE DEL NUEVO GESTO. Un panel cerrado no puede pintarse activo:
// si el icono se queda encendido sobre un panel que no está, el clic que lo
// cerró parece no haber hecho nada, y el usuario vuelve a pulsarlo.
describe("railActiveKey y el panel plegado", () => {
  it("con la página delante, el panel ABIERTO se pinta activo", () => {
    expect(railActiveKey("page", "chat", false)).toBe("chat");
  });

  it("y el PLEGADO no se pinta nada", () => {
    expect(railActiveKey("page", "chat", true)).toBe("");
  });

  // BRAZO DE CONTROL: plegar el panel no apaga la SECCIÓN. Son dos cosas
  // distintas — el panel es una herramienta sobre la página, la sección es lo
  // que ocupa el centro — y en Resultados el icono sigue encendido esté el
  // panel como esté.
  it("pero una sección del centro se pinta activa aunque el panel esté plegado", () => {
    expect(railActiveKey("resultados", "chat", true)).toBe("resultados");
    expect(railActiveKey("analytics", "chat", true)).toBe("resultados");
  });
});
