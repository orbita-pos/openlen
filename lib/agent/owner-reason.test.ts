// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ownerReasonFrom } from "./owner-reason";

describe("ownerReasonFrom — lo que llega del stream o de una fila guardada", () => {
  it("un código conocido pasa, con sus datos", () => {
    expect(ownerReasonFrom({ code: "address_invalid", address: "mi negocio" })).toEqual({
      code: "address_invalid",
      address: "mi negocio",
    });
    expect(ownerReasonFrom({ code: "search_limit", limit: 8 })).toEqual({ code: "search_limit", limit: 8 });
  });

  // Sin esto la tarjeta pintaría una clave de traducción cruda, o reventaría
  // `t()` con una que no existe.
  it("🔴 un código que la lista no conoce se descarta entero", () => {
    expect(ownerReasonFrom({ code: "you_made_that_name_up" })).toBeUndefined();
    expect(ownerReasonFrom({ code: 3 })).toBeUndefined();
    expect(ownerReasonFrom("address_needed")).toBeUndefined();
    expect(ownerReasonFrom(null)).toBeUndefined();
  });

  it("los datos que no son lo que dicen ser se quitan, y la dirección se acota", () => {
    expect(ownerReasonFrom({ code: "search_limit", limit: -1 })).toEqual({ code: "search_limit" });
    expect(ownerReasonFrom({ code: "search_limit", limit: 2.5 })).toEqual({ code: "search_limit" });
    expect(ownerReasonFrom({ code: "address_invalid", address: "   " })).toEqual({ code: "address_invalid" });
    expect(ownerReasonFrom({ code: "address_invalid", address: "x".repeat(500) })!.address).toHaveLength(63);
    // Lo que no es de la forma no viaja: ni prosa colada ni campos de más.
    expect(ownerReasonFrom({ code: "page_changed", error: "the page changed again…" })).toEqual({ code: "page_changed" });
  });
});
