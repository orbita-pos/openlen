// Los filtros de `postgres_changes`: los doctests de su
// `Subscriptions.parse_subscription_params` (supabase/realtime @ f86df8c3,
// lib/extensions/postgres_cdc_rls/subscriptions.ex), uno a uno.
import { describe, expect, it } from "vitest";

import { parseSubscriptionParams } from "./subscriptions";

const ok = (action: string, schema: string, table: string, filters: [string, string, string, boolean][], select: string[] | null = null) => ({
  ok: true,
  params: { action, schema, table, filters, selectedColumns: select },
});

describe("parseSubscriptionParams (sus doctests)", () => {
  it("eq", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "subject=eq.hey" })).toEqual(ok("*", "public", "messages", [["subject", "eq", "hey", false]]));
  });
  it("in", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "subject=in.(hidee,ho)" })).toEqual(
      ok("*", "public", "messages", [["subject", "in", "{hidee,ho}", false]]),
    );
  });
  it("negación con not.", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "subject=not.like.hey%" })).toEqual(
      ok("*", "public", "messages", [["subject", "like", "hey%", true]]),
    );
  });
  it("varios filtros con comas (AND)", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "id=gt.0,id=lt.100" })).toEqual(
      ok("*", "public", "messages", [
        ["id", "gt", "0", false],
        ["id", "lt", "100", false],
      ]),
    );
  });
  it("filtro vacío o de espacios = sin filtro", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "" })).toEqual(ok("*", "public", "messages", []));
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "   " })).toEqual(ok("*", "public", "messages", []));
  });
  it("sin filtro, sólo esquema, sólo tabla", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages" })).toEqual(ok("*", "public", "messages", []));
    expect(parseSubscriptionParams({ schema: "public" })).toEqual(ok("*", "public", "*", []));
    expect(parseSubscriptionParams({ table: "messages" })).toEqual(ok("*", "public", "messages", []));
  });
  it("el evento", () => {
    expect(parseSubscriptionParams({ event: "insert", schema: "public", table: "messages" })).toMatchObject({ params: { action: "INSERT" } });
    expect(parseSubscriptionParams({ event: "otra", schema: "public", table: "messages" })).toMatchObject({ params: { action: "*" } });
  });
  it("operador desconocido, `undefined` y sin parámetros: sus errores", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "subject=foo.hey" })).toEqual({ ok: false, error: 'Error parsing `filter` params: ["foo", "hey"]' });
    expect(parseSubscriptionParams({ schema: "public", table: "messages", filter: "undefined" })).toEqual({ ok: false, error: 'Error parsing `filter` params: ["undefined"]' });
    expect(parseSubscriptionParams({})).toEqual({
      ok: false,
      error: "No subscription params provided. Please provide at least a `schema` or `table` to subscribe to: %{}",
    });
  });
  it("in sin paréntesis, segmento vacío, select de texto y select en comodín: sus errores", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "t", filter: "id=in.1,2" })).toEqual({ ok: false, error: "Error parsing `filter` params: `in` filter value must be wrapped by parentheses" });
    expect(parseSubscriptionParams({ schema: "public", table: "t", filter: "id=eq.1,,id=eq.2" })).toEqual({
      ok: false,
      error: "Error parsing `filter` params: filter must not contain empty segments (check for extra commas)",
    });
    expect(parseSubscriptionParams({ schema: "public", table: "t", select: "a" })).toEqual({
      ok: false,
      error: 'Error parsing `select` params: expected a list of column name strings, e.g. select: ["col1", "col2"]',
    });
    expect(parseSubscriptionParams({ schema: "public", select: ["a"] })).toEqual({
      ok: false,
      error: "Column selection is not supported for wildcard subscriptions. Provide an explicit schema and table name.",
    });
  });
  it("valores entre comillas y comas dentro de paréntesis", () => {
    expect(parseSubscriptionParams({ schema: "public", table: "t", filter: 'nombre=eq."a,b",id=in.(1,2)' })).toEqual(
      ok("*", "public", "t", [
        ["nombre", "eq", "a,b", false],
        ["id", "in", "{1,2}", false],
      ]),
    );
  });
});
