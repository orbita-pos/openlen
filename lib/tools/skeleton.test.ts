// @vitest-environment node
import { describe, expect, it } from "vitest";

import { esqueletoDeApp } from "@/lib/apps/esqueleto";

import { readToolManifest } from "./manifest";
import { PLACEHOLDER_ICON_SHA, toolSkeleton } from "./skeleton";

describe("toolSkeleton", () => {
  it("is a valid tool, placed in the rail, in the person's language and English", () => {
    const s = toolSkeleton({ title: "Reservas", locale: "es" });
    const r = readToolManifest(s.files, { personLocale: "es", placeholderIconSha: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.placement).toBe("rail");
      expect(r.manifest.titles).toEqual({ en: "Reservas", es: "Reservas" });
    }
  });

  it("its placeholder icon is refused until the Creator replaces it", () => {
    const s = toolSkeleton({ title: "Reservas", locale: "es" });
    const r = readToolManifest(s.files, { personLocale: "es", placeholderIconSha: PLACEHOLDER_ICON_SHA });
    expect(r).toEqual({ ok: false, problems: [{ code: "icon_is_placeholder", file: "/icon.svg" }] });
  });

  it("declares window.openlen for the type checker", () => {
    const d = toolSkeleton({ title: "Reservas", locale: "es" }).files["/src/openlen.d.ts"];
    expect(d).toMatch(/interface Window \{[^}]*openlen: OpenLenBridge/);
    for (const method of ["context", "onContext", "backend", "projects", "forms", "visits", "query", "update", "sendPrompt"]) {
      expect(d).toContain(`${method}(`);
    }
  });

  it("is an app skeleton underneath: the same shell, data.app and /src", () => {
    const s = toolSkeleton({ title: "Reservas", locale: "es" });
    const app = esqueletoDeApp({ titulo: "Reservas", idioma: "es" });
    expect(s.html).toBe(app.html);
    expect(s.app).toEqual(app.app);
    for (const [path, content] of Object.entries(app.ficheros)) {
      if (path === "/package.json" || path === "/src/lib/supabase.ts") continue;
      expect(s.files[path]).toBe(content);
    }
    expect(typeof s.tool.bornAt).toBe("string");
  });

  it("its package.json keeps the app's dependencies and adds the tool's fields", () => {
    const s = toolSkeleton({ title: "Reservas", locale: "es" });
    const app = JSON.parse(esqueletoDeApp({ titulo: "Reservas", idioma: "es" }).ficheros["/package.json"]!) as { dependencies: unknown };
    const pkg = JSON.parse(s.files["/package.json"]!) as Record<string, unknown>;
    expect(pkg.dependencies).toEqual(app.dependencies);
    expect(pkg.openlen).toEqual({ tool: { placement: "rail" } });
    expect(pkg.version).toBe("1.0.0");
  });

  it("its backend client signs in as the person through the bridge", () => {
    expect(toolSkeleton({ title: "Reservas", locale: "es" }).files["/src/lib/supabase.ts"]).toContain("window.openlen.backend()");
  });

  it("an English person gets one locale file", () => {
    const s = toolSkeleton({ title: "Bookings", locale: "en" });
    expect(Object.keys(s.files).filter((p) => p.startsWith("/locale/"))).toEqual(["/locale/en.json"]);
  });
});
