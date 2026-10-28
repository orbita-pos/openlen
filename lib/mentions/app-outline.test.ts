import { describe, expect, it } from "vitest";

import { compilarFuente } from "@/lib/apps/compilador";

import { outlineApp, outlineFile } from "./app-outline";

const APP = [
  'import { useState } from "react";',
  'import { ProductCard } from "./ProductCard";',
  "",
  "export default function App() {",
  "  const [open, setOpen] = useState(false);",
  "  const items = [1, 2, 3];",
  "  return (",
  '    <main className="shell" id="top">',
  "      <h1>Pedidos</h1>",
  "      <ul>",
  "        {items.map((i) => (",
  "          <li key={i}>Pedido {i}</li>",
  "        ))}",
  "      </ul>",
  '      <button aria-label="Abrir" onClick={() => setOpen(true)} />',
  "      {open && <section><p>Detalle</p></section>}",
  "      <ProductCard />",
  "    </main>",
  "  );",
  "}",
  "",
].join("\n");

const CARD = [
  "export function ProductCard() {",
  "  return (",
  '    <div className="card">',
  '      <img alt="pan" src="/pan.jpg" />',
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");

describe("outlineFile", () => {
  it("gives exactly the lines the compiler stamps on each element in development", async () => {
    const compiled = compilarFuente("/src/App.tsx", APP, {
      carpeta: { "/src/App.tsx": APP, "/src/ProductCard.tsx": CARD },
      catalogo: "2026-11",
      development: true,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const fromCompiler = new Set([...compiled.js.matchAll(/lineNumber: (\d+)/g)].map((m) => Number(m[1])));
    const fromOutline = new Set((await outlineFile("/src/App.tsx", APP)).map((e) => e.line));
    expect([...fromOutline].sort((a, b) => a - b)).toEqual([...fromCompiler].sort((a, b) => a - b));
  });

  it("lists elements behind a condition and a loop's element once", async () => {
    const entries = await outlineFile("/src/App.tsx", APP);
    expect(entries.filter((e) => e.tag === "li")).toHaveLength(1);
    expect(entries.find((e) => e.tag === "p")?.text).toBe("Detalle");
    const li = entries.find((e) => e.tag === "li")!;
    expect(li.target).toEqual({ type: "app", path: "/src/App.tsx", line: 12, tag: "li", text: "Pedido" });
  });

  it("names elements from literal attributes and their component", async () => {
    const entries = await outlineFile("/src/App.tsx", APP);
    const main = entries.find((e) => e.tag === "main")!;
    expect(main.attrs).toEqual({ className: "shell", id: "top" });
    expect(main.component).toBe("App");
    const button = entries.find((e) => e.tag === "button")!;
    expect(button.name).toBe("Abrir");
    expect(button.kind).toBe("button");
    expect(entries.find((e) => e.tag === "h1")!.parent).toBe(main.key);
  });

  it("keeps the elements TypeScript recovers from a file that does not parse cleanly", async () => {
    const broken = "export function X() {\n  return <div><p>hola</p>\n";
    const entries = await outlineFile("/src/X.tsx", broken);
    expect(entries.map((e) => e.tag)).toContain("p");
  });
});

describe("outlineApp", () => {
  it("separates a component's definition from where it is used", async () => {
    const entries = await outlineApp({ "/src/App.tsx": APP, "/src/ProductCard.tsx": CARD });
    const use = entries.find((e) => e.tag === "ProductCard")!;
    expect(use.ruta).toBe("/src/App.tsx");
    const img = entries.find((e) => e.tag === "img")!;
    expect(img.ruta).toBe("/src/ProductCard.tsx");
    expect(img.component).toBe("ProductCard");
    expect(img.name).toBe("pan");
  });

  it("skips tests and puts shadcn's components/ui last", async () => {
    const entries = await outlineApp({
      "/src/components/ui/button.tsx": "export function Button() { return <button>b</button>; }",
      "/src/App.test.tsx": "export const t = <div>test</div>;",
      "/src/App.tsx": APP,
      "/src/styles.css": "body{}",
    });
    expect(entries.some((e) => e.ruta === "/src/App.test.tsx")).toBe(false);
    expect(entries.some((e) => e.ruta === "/src/styles.css")).toBe(false);
    expect(entries.at(-1)!.ruta).toBe("/src/components/ui/button.tsx");
  });
});

describe("the screen an element lives on", () => {
  it("comes from the routes: what a routed component writes is on its #/ screen", async () => {
    const files = {
      "/src/App.tsx": [
        'import { Routes, Route } from "react-router-dom";',
        'import Ventas from "./Ventas";',
        "function Inicio() { return <h1>Hola</h1>; }",
        "export default function App() {",
        '  return <Routes><Route path="/" element={<Inicio />} /><Route path="/ventas" element={<Ventas />} /></Routes>;',
        "}",
      ].join("\n"),
      "/src/Ventas.tsx": "export default function Ventas() {\n  return <table><tbody><tr><td>1</td></tr></tbody></table>;\n}\n",
    };
    const entries = await outlineApp(files);
    expect(entries.find((e) => e.tag === "h1")!.screen).toBe("#/");
    expect(entries.find((e) => e.tag === "table")!.screen).toBe("#/ventas");
    expect(entries.find((e) => e.tag === "Routes")!.screen).toBeUndefined();
  });
});
