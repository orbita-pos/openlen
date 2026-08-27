import { describe, expect, it } from "vitest";
import {
  RAIL_CREAR,
  RAIL_OPERAR,
  railActiveKey,
  railItemKey,
} from "./rail-model";

describe("rail único", () => {
  it("tiene los 11 ítems aprobados, en orden, sin duplicados", () => {
    const keys = [...RAIL_CREAR, ...RAIL_OPERAR].map(railItemKey);
    expect(keys).toEqual([
      "pagina", "site", "chat", "images",
      "modulos", "resultados", "messages", "marketing", "business", "versions",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
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
