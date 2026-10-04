// @vitest-environment node
//
// El parser de la URL de /rest/v1, portado de PostgREST
// (src/library/PostgREST/ApiRequest/QueryParams.hs, v16.4). Los casos salen de
// los doctests de ese fichero: son su especificación.
import { describe, expect, it } from "vitest";

import { parseFilter, parseLogicTree, parseOrder, parseQueryString, parseSelect } from "./parse";

const f = (name: string, jsonPath: { arrow: "->" | "->>"; key?: string; idx?: string }[] = []) => ({ name, jsonPath });

describe("select", () => {
  it("campos, alias, casts y rutas JSON", () => {
    expect(parseSelect("name")).toEqual([{ kind: "field", field: f("name") }]);
    expect(parseSelect("name->jsonpath")).toEqual([{ kind: "field", field: f("name", [{ arrow: "->", key: "jsonpath" }]) }]);
    expect(parseSelect("name::cast")).toEqual([{ kind: "field", field: f("name"), cast: "cast" }]);
    expect(parseSelect("alias:name")).toEqual([{ kind: "field", field: f("name"), alias: "alias" }]);
    expect(parseSelect("alias:name->jsonpath::cast")).toEqual([
      { kind: "field", field: f("name", [{ arrow: "->", key: "jsonpath" }]), cast: "cast", alias: "alias" },
    ]);
    expect(parseSelect("alias:name->!@#$%^&*_a::cast")).toEqual([
      { kind: "field", field: f("name", [{ arrow: "->", key: "!@#$%^&*_a" }]), cast: "cast", alias: "alias" },
    ]);
    expect(parseSelect("*")).toEqual([{ kind: "field", field: f("*") }]);
    expect(parseSelect("data->>a,data->0->b")).toEqual([
      { kind: "field", field: f("data", [{ arrow: "->>", key: "a" }]) },
      { kind: "field", field: f("data", [{ arrow: "->", idx: "+0" }, { arrow: "->", key: "b" }]) },
    ]);
  });

  it("varios, con espacios", () => {
    expect(parseSelect("id, name ,  price")).toEqual([
      { kind: "field", field: f("id") },
      { kind: "field", field: f("name") },
      { kind: "field", field: f("price") },
    ]);
  });

  it("recursos embebidos, con alias, pista y tipo de join", () => {
    expect(parseSelect("rel(*)")).toEqual([{ kind: "relation", name: "rel", children: [{ kind: "field", field: f("*") }] }]);
    expect(parseSelect("alias:rel(*)")[0]).toMatchObject({ kind: "relation", name: "rel", alias: "alias" });
    expect(parseSelect("rel!hint(*)")[0]).toMatchObject({ kind: "relation", name: "rel", hint: "hint" });
    expect(parseSelect("rel!inner(*)")[0]).toMatchObject({ kind: "relation", name: "rel", joinType: "inner" });
    expect(parseSelect("alias:rel!inner!hint(*)")[0]).toMatchObject({ name: "rel", alias: "alias", hint: "hint", joinType: "inner" });
    expect(parseSelect("...rel!hint!inner(*)")[0]).toMatchObject({ kind: "spread", name: "rel", hint: "hint", joinType: "inner" });
    expect(parseSelect("*, author:profiles(id, name, posts(title))")).toEqual([
      { kind: "field", field: f("*") },
      {
        kind: "relation",
        name: "profiles",
        alias: "author",
        children: [
          { kind: "field", field: f("id") },
          { kind: "field", field: f("name") },
          { kind: "relation", name: "posts", children: [{ kind: "field", field: f("title") }] },
        ],
      },
    ]);
  });

  it("agregados", () => {
    expect(parseSelect("count()")).toEqual([{ kind: "field", field: f("*"), aggregate: "count" }]);
    expect(parseSelect("total:amount.sum()")).toEqual([{ kind: "field", field: f("amount"), aggregate: "sum", alias: "total" }]);
  });

  it("lo que no se puede parsear lanza un error de PostgREST (PGRST100)", () => {
    expect(() => parseSelect("name!hint")).toThrow(expect.objectContaining({ code: "PGRST100" }));
    expect(() => parseSelect("name::")).toThrow(expect.objectContaining({ code: "PGRST100" }));
  });
});

describe("filtros", () => {
  it("operadores simples y cuantificados", () => {
    expect(parseFilter("id", "eq.1")).toEqual({ path: [], filter: { field: f("id"), expr: { not: false, op: { kind: "quant", op: "eq", value: "1" } } } });
    expect(parseFilter("id", "eq(any).value").filter.expr).toEqual({ not: false, op: { kind: "quant", op: "eq", quant: "any", value: "value" } });
    expect(parseFilter("id", "not.eq(all).value").filter.expr).toEqual({ not: true, op: { kind: "quant", op: "eq", quant: "all", value: "value" } });
    expect(parseFilter("a", "gte.5").filter.expr.op).toEqual({ kind: "quant", op: "gte", value: "5" });
    expect(parseFilter("a", "gt.5").filter.expr.op).toEqual({ kind: "quant", op: "gt", value: "5" });
    expect(parseFilter("a", "neq.x.y").filter.expr.op).toEqual({ kind: "simple", op: "neq", value: "x.y" });
    expect(parseFilter("a", "cs.{1,2}").filter.expr.op).toEqual({ kind: "simple", op: "cs", value: "{1,2}" });
    expect(parseFilter("name", "ilike.*ana*").filter.expr.op).toEqual({ kind: "quant", op: "ilike", value: "*ana*" });
    expect(parseFilter("name", "like(any).{a*,b*}").filter.expr.op).toEqual({ kind: "quant", op: "like", quant: "any", value: "{a*,b*}" });
  });

  it("in, is, isdistinct, fts", () => {
    expect(parseFilter("id", "in.(1,2,3)").filter.expr.op).toEqual({ kind: "in", values: ["1", "2", "3"] });
    expect(parseFilter("n", 'in.("a,b",c)').filter.expr.op).toEqual({ kind: "in", values: ["a,b", "c"] });
    expect(parseFilter("id", "not.in.(1)").filter.expr).toEqual({ not: true, op: { kind: "in", values: ["1"] } });
    expect(parseFilter("x", "is.null").filter.expr.op).toEqual({ kind: "is", value: "null" });
    expect(parseFilter("x", "is.NOT_NULL").filter.expr.op).toEqual({ kind: "is", value: "not_null" });
    expect(parseFilter("x", "isdistinct.3").filter.expr.op).toEqual({ kind: "isdistinct", value: "3" });
    expect(parseFilter("t", "fts(spanish).gato").filter.expr.op).toEqual({ kind: "fts", op: "fts", lang: "spanish", value: "gato" });
    expect(parseFilter("t", "wfts.gato perro").filter.expr.op).toEqual({ kind: "fts", op: "wfts", value: "gato perro" });
  });

  it("rutas JSON en la clave y recursos embebidos", () => {
    expect(parseFilter("data->>k", "eq.x").filter.field).toEqual(f("data", [{ arrow: "->>", key: "k" }]));
    expect(parseFilter("author.name", "eq.x")).toMatchObject({ path: ["author"], filter: { field: f("name") } });
  });

  it("lo que no es un operador falla con PGRST100", () => {
    expect(() => parseFilter("id", "val")).toThrow(expect.objectContaining({ code: "PGRST100" }));
    expect(() => parseFilter("a", "noop.0")).toThrow(expect.objectContaining({ code: "PGRST100" }));
    expect(() => parseFilter("a", "eq().value")).toThrow(expect.objectContaining({ code: "PGRST100" }));
    expect(() => parseFilter("a", "in().value")).toThrow(expect.objectContaining({ code: "PGRST100" }));
  });
});

describe("or / and", () => {
  it("árboles anidados, con not", () => {
    expect(parseLogicTree("or", "(id.eq.1,and(a.gt.2,b.not.is.null))")).toEqual({
      path: [],
      tree: {
        kind: "expr",
        not: false,
        op: "or",
        children: [
          { kind: "stmt", filter: { field: f("id"), expr: { not: false, op: { kind: "quant", op: "eq", value: "1" } } } },
          {
            kind: "expr",
            not: false,
            op: "and",
            children: [
              { kind: "stmt", filter: { field: f("a"), expr: { not: false, op: { kind: "quant", op: "gt", value: "2" } } } },
              { kind: "stmt", filter: { field: f("b"), expr: { not: true, op: { kind: "is", value: "null" } } } },
            ],
          },
        ],
      },
    });
    expect(parseLogicTree("not.or", "(a.eq.1,b.eq.2)").tree).toMatchObject({ kind: "expr", not: true, op: "or" });
    expect(parseLogicTree("posts.or", "(a.eq.1,b.eq.2)").path).toEqual(["posts"]);
  });

  it("valores con comas entre comillas, arrays e in", () => {
    const t = parseLogicTree("or", '(name.eq."a,b",tags.cs.{x,y},id.in.(1,2))').tree;
    expect(t).toMatchObject({
      children: [
        { filter: { expr: { op: { value: "a,b" } } } },
        { filter: { expr: { op: { kind: "simple", op: "cs", value: "{x,y}" } } } },
        { filter: { expr: { op: { kind: "in", values: ["1", "2"] } } } },
      ],
    });
  });

  it("errores de los doctests", () => {
    for (const v of ["()", "(id.in.1,2,id.eq.3)"]) {
      expect(() => parseLogicTree("or", v), v).toThrow(expect.objectContaining({ code: "PGRST100" }));
    }
  });
});

describe("order", () => {
  it("los casos de los doctests", () => {
    expect(parseOrder("name.desc.nullsfirst")).toEqual([{ kind: "field", field: f("name"), dir: "desc", nulls: "first" }]);
    expect(parseOrder("json_col->key.asc.nullslast")).toEqual([
      { kind: "field", field: f("json_col", [{ arrow: "->", key: "key" }]), dir: "asc", nulls: "last" },
    ]);
    expect(parseOrder("clients(json_col->key).desc.nullsfirst")).toEqual([
      { kind: "relation", relation: "clients", field: f("json_col", [{ arrow: "->", key: "key" }]), dir: "desc", nulls: "first" },
    ]);
    expect(parseOrder("name,clients(name),id")).toEqual([
      { kind: "field", field: f("name") },
      { kind: "relation", relation: "clients", field: f("name") },
      { kind: "field", field: f("id") },
    ]);
    for (const bad of ["clients(name,id)", "id.ac", "id.descc", "id.nulsfist", "id.nullslasttt", "id.asc.nlsfst"]) {
      expect(() => parseOrder(bad), bad).toThrow(expect.objectContaining({ code: "PGRST100" }));
    }
  });
});

describe("la query string entera", () => {
  it("separa select, filtros, order, límites, columns y on_conflict como PostgREST", () => {
    const q = parseQueryString(
      "select=id,name&id=gte.2&name=ilike.*a*&or=(a.eq.1,b.eq.2)&order=id.desc&limit=10&offset=5&columns=id,name&on_conflict=id&posts.order=title&posts.limit=2",
    );
    expect(q.select).toHaveLength(2);
    expect(q.filters.map((x) => x.filter.field.name)).toEqual(["id", "name"]);
    expect(q.logic).toHaveLength(1);
    expect(q.order).toEqual([{ path: [], terms: [{ kind: "field", field: f("id"), dir: "desc" }] }, { path: ["posts"], terms: [{ kind: "field", field: f("title") }] }]);
    expect(q.ranges).toEqual({ "": { offset: 5, limit: 10 }, posts: { offset: 0, limit: 2 } });
    expect(q.columns).toEqual(["id", "name"]);
    expect(q.onConflict).toEqual(["id"]);
  });

  it("sin select es *; los + son espacios", () => {
    const q = parseQueryString("name=eq.ana+maria");
    expect(q.select).toEqual([{ kind: "field", field: f("*") }]);
    expect(q.filters[0]!.filter.expr.op).toEqual({ kind: "quant", op: "eq", value: "ana maria" });
  });

  it("los parámetros vacíos no cuentan", () => {
    expect(parseQueryString("id=&select=").filters).toEqual([]);
  });
});
