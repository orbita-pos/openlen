import { describe, expect, it } from "vitest";
import {
  RAIL_CREAR,
  RAIL_OPERAR,
  railActiveKey,
  railItemKey,
} from "./rail-model";

describe("rail único", () => {
  /**
   * `site` SALIÓ DEL RAIL el 2026-08-27. Las páginas del sitio se navegan desde
   * la barra de dirección, arriba del lienzo: estaban escondidas tras un icono
   * que había que descubrir, mientras «¿en qué página estoy?» se respondía en
   * tres sitios que no se hablaban. El panel no se borró — `SitePagesPanel` se
   * monta dentro del desplegable de la barra.
   */
  it("tiene los ítems aprobados, en orden, sin duplicados", () => {
    const keys = [...RAIL_CREAR, ...RAIL_OPERAR].map(railItemKey);
    expect(keys).toEqual([
      "pagina", "chat", "images",
      "modulos", "resultados", "messages", "marketing", "business", "versions",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("y el rail ya no lleva las páginas — se navegan por la dirección", () => {
    const keys = [...RAIL_CREAR, ...RAIL_OPERAR].map(railItemKey);
    expect(keys, "volvió el icono de páginas al rail: ahora vive en AddressBar").not.toContain(
      "site",
    );
  });

  it("badges: leads en resultados, chat en messages", () => {
    const by = Object.fromEntries(
      [...RAIL_OPERAR].map((i) => [railItemKey(i), i]),
    );
    expect(by.resultados.kind === "view" && by.resultados.badge).toBe("leads");
    expect(by.messages.kind === "view" && by.messages.badge).toBe("chat");
  });

  it("railActiveKey: vista central activa su ítem; analytics es alias de resultados", () => {
    expect(railActiveKey("modulos", "site")).toBe("modulos");
    expect(railActiveKey("resultados", "chat")).toBe("resultados");
    expect(railActiveKey("analytics", "chat")).toBe("resultados");
    expect(railActiveKey("messages", "images")).toBe("messages");
  });

  it("railActiveKey: en canvas activa el panel actual", () => {
    expect(railActiveKey("page", "site")).toBe("site");
    expect(railActiveKey("page", "versions")).toBe("versions");
  });
});
