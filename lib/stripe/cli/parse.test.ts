import { describe, expect, it } from "vitest";

import { parseStripeArgs } from "./parse";

describe("parseStripeArgs", () => {
  it("Real test: --version, -v and version print the CLI's version line, like the release the port comes from", () => {
    for (const args of [["--version"], ["-v"], ["version"]]) {
      expect(parseStripeArgs(args)).toEqual({ kind: "help", text: "stripe version 1.55.0\n" });
    }
  });

  it("maps a resource command's flags to Stripe params like the CLI", () => {
    const c = parseStripeArgs(["prices", "create", "--product=curso", "--unit-amount=2900", "--currency", "usd", "--recurring.interval=month", "--lookup-key=curso"]);
    expect(c).toMatchObject({
      kind: "operation",
      path: "/v1/prices",
      live: false,
      form: [["product", "curso"], ["unit_amount", "2900"], ["currency", "usd"], ["recurring[interval]", "month"], ["lookup_key", "curso"]],
    });
    if (c.kind === "operation") expect(c.op.method).toBe("POST");
  });

  it("takes -d data verbatim and the id as a path argument", () => {
    expect(parseStripeArgs(["products", "update", "curso", "-d", "metadata[k]=v"])).toMatchObject({ kind: "operation", path: "/v1/products/curso", form: [["metadata[k]", "v"]] });
    expect(parseStripeArgs(["products", "update", "curso", "--data=metadata[k]=a=b"])).toMatchObject({ form: [["metadata[k]", "a=b"]] });
  });

  it("knows two-word resources", () => {
    expect(parseStripeArgs(["checkout", "sessions", "list", "--limit=3"])).toMatchObject({ kind: "operation", path: "/v1/checkout/sessions", form: [["limit", "3"]] });
  });

  it("array params get []", () => {
    expect(parseStripeArgs(["webhook_endpoints", "create", "--url=https://x/functions/v1/pago", "--enabled-events=checkout.session.completed", "--enabled-events=charge.refunded"])).toMatchObject({
      form: [["url", "https://x/functions/v1/pago"], ["enabled_events[]", "checkout.session.completed"], ["enabled_events[]", "charge.refunded"]],
    });
  });

  it("a bare boolean flag is true", () => {
    expect(parseStripeArgs(["products", "create", "--name=A", "--active"])).toMatchObject({ form: [["name", "A"], ["active", "true"]] });
    expect(parseStripeArgs(["products", "create", "--name=A", "--active=false"])).toMatchObject({ form: [["name", "A"], ["active", "false"]] });
  });

  it("--live, --confirm, --expand and --idempotency are flags, not params", () => {
    expect(parseStripeArgs(["customers", "delete", "cus_1", "--live", "--confirm"])).toMatchObject({ kind: "operation", path: "/v1/customers/cus_1", live: true, confirm: true, form: [] });
    expect(parseStripeArgs(["payment_intents", "retrieve", "pi_1", "-e", "customer", "-i", "k1", "-c"])).toMatchObject({
      form: [["expand[]", "customer"]],
      idempotencyKey: "k1",
      confirm: true,
    });
  });

  it("get/post/delete with a path", () => {
    expect(parseStripeArgs(["get", "/v1/balance"])).toMatchObject({ kind: "raw", method: "GET", path: "/v1/balance", live: false });
    expect(parseStripeArgs(["post", "/v1/products", "-d", "name=A", "--live"])).toMatchObject({ kind: "raw", method: "POST", path: "/v1/products", form: [["name", "A"]], live: true });
    expect(parseStripeArgs(["delete", "/v1/products/curso", "--confirm"])).toMatchObject({ kind: "raw", method: "DELETE", confirm: true });
    expect(parseStripeArgs(["get", "balance"])).toMatchObject({ kind: "raw", path: "/v1/balance" });
  });

  it("trigger and listen", () => {
    expect(parseStripeArgs(["trigger", "checkout.session.completed"])).toEqual({ kind: "trigger", event: "checkout.session.completed", live: false });
    expect(parseStripeArgs(["listen", "--forward-to", "localhost:4242"])).toEqual({ kind: "listen" });
  });

  it("login, logout, config and --api-key are credentials commands", () => {
    expect(parseStripeArgs(["login"])).toEqual({ kind: "credentials", command: "login" });
    expect(parseStripeArgs(["config", "--list"])).toEqual({ kind: "credentials", command: "config" });
    expect(parseStripeArgs(["products", "list", "--api-key", "sk_test_x"])).toEqual({ kind: "credentials", command: "--api-key" });
  });

  it("help for the root, a resource and an operation", () => {
    const root = parseStripeArgs([]);
    expect(root.kind).toBe("help");
    if (root.kind === "help") expect(root.text).toContain("products");
    const r = parseStripeArgs(["products", "--help"]);
    expect(r.kind).toBe("help");
    if (r.kind === "help") expect(r.text).toContain("Available Operations:\n  create\n");
    const o = parseStripeArgs(["prices", "create", "-h"]);
    if (o.kind === "help") expect(o.text).toContain("--unit-amount");
    else throw new Error("expected help");
  });

  it("an unknown resource or operation is a usage error that lists what exists, like the CLI", () => {
    const a = parseStripeArgs(["productz", "list"]);
    expect(a.kind).toBe("usage_error");
    if (a.kind === "usage_error") expect(a.message).toContain('unknown command "productz" for "stripe"');
    const b = parseStripeArgs(["products", "frobnicate"]);
    if (b.kind === "usage_error") expect(b.message).toMatch(/unknown command "frobnicate" for "stripe products"[\s\S]*Available Operations:[\s\S]*create/);
    else throw new Error("expected usage_error");
  });

  it("a missing id, an unknown flag or a flag without its value are usage errors", () => {
    expect(parseStripeArgs(["products", "retrieve"])).toMatchObject({ kind: "usage_error" });
    expect(parseStripeArgs(["products", "create", "--nombre=A"])).toMatchObject({ kind: "usage_error", message: expect.stringContaining("unknown flag: --nombre") });
    expect(parseStripeArgs(["products", "create", "--name"])).toMatchObject({ kind: "usage_error" });
  });
});
