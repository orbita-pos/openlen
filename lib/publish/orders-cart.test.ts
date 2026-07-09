import { describe, expect, it } from "vitest";
import { injectOrdersCart } from "./orders-cart";

const PAGE_WITH_BUTTONS =
  '<!doctype html><html><head></head><body><button data-ol-order-add data-ol-order-id="a" data-ol-order-title="Tacos" data-ol-order-price="$90" data-ol-order-cents="9000">Agregar</button></body></html>';
const PAGE_WITHOUT = "<!doctype html><html><head></head><body><h1>Hola</h1></body></html>";

describe("injectOrdersCart", () => {
  it("injects the sealed runtime when add-buttons are present", () => {
    const out = injectOrdersCart(PAGE_WITH_BUTTONS, { number: "5512345678", projectId: "p1", page: null });
    expect(out).toContain("data-ol-orders-widget");
    expect(out.lastIndexOf("data-ol-orders-widget")).toBeLessThan(out.lastIndexOf("</body>"));
  });

  it("is a no-op on a document with no order buttons", () => {
    expect(injectOrdersCart(PAGE_WITHOUT, { number: "5512345678" })).toBe(PAGE_WITHOUT);
  });

  it("is idempotent", () => {
    const once = injectOrdersCart(PAGE_WITH_BUTTONS, { number: "5512345678" });
    expect(injectOrdersCart(once, { number: "5512345678" })).toBe(once);
  });

  it("is a no-op with an unusable number", () => {
    expect(injectOrdersCart(PAGE_WITH_BUTTONS, { number: "123" })).toBe(PAGE_WITH_BUTTONS);
  });

  it("embeds the +52-normalized wa.me base for a 10-digit MX number", () => {
    const out = injectOrdersCart(PAGE_WITH_BUTTONS, { number: "5512345678" });
    expect(out).toContain("https://wa.me/525512345678");
  });

  it("embeds the analytics beacon path + order event type when projectId present", () => {
    const out = injectOrdersCart(PAGE_WITH_BUTTONS, { number: "5512345678", projectId: "p1" });
    expect(out).toContain('"/c/"');
    expect(out).toContain('t:"o"');
  });

  it("omits the beacon entirely without projectId", () => {
    const out = injectOrdersCart(PAGE_WITH_BUTTONS, { number: "5512345678" });
    expect(out).not.toContain('t:"o"');
  });

  it("JSON-escapes the embedded config (no raw </script> breakout)", () => {
    const out = injectOrdersCart(PAGE_WITH_BUTTONS, {
      number: "5512345678",
      projectId: 'x"</script><script>alert(1)</script>',
    });
    expect(out).not.toContain("</script><script>alert(1)");
  });
});
