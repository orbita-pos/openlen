// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { makePointer } from "@/lib/files/blob-pointer";

import { ICON_MAX_BYTES, readToolManifest } from "./manifest";

const SVG = `<?xml version="1.0"?>\n<!-- reservas -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const pkg = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "reservas-de-hoy",
    version: "1.0.0",
    private: true,
    openlen: { tool: { placement: "rail" } },
    exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
    ...over,
  });

const meta = (title: string, description: string) => JSON.stringify({ meta: { title, description } });

const valid = (over: Record<string, string | undefined> = {}): Record<string, string> => {
  const files: Record<string, string | undefined> = {
    "/package.json": pkg(),
    "/locale/en.json": meta("Today's bookings", "See and confirm today's bookings."),
    "/locale/es.json": meta("Reservas de hoy", "Ver y confirmar las reservas de hoy."),
    "/icon.svg": SVG,
    ...over,
  };
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== undefined));
};

const read = (files: Record<string, string>, personLocale = "es", placeholderIconSha = "x") =>
  readToolManifest(files, { personLocale, placeholderIconSha });

const codes = (files: Record<string, string>, personLocale = "es", placeholderIconSha = "x") => {
  const r = read(files, personLocale, placeholderIconSha);
  return r.ok ? [] : r.problems.map((p) => p.code);
};

describe("readToolManifest", () => {
  it("reads a valid tool", () => {
    const r = read(valid());
    expect(r).toEqual({
      ok: true,
      manifest: {
        name: "reservas-de-hoy",
        version: "1.0.0",
        placement: "rail",
        titles: { en: "Today's bookings", es: "Reservas de hoy" },
        descriptions: { en: "See and confirm today's bookings.", es: "Ver y confirmar las reservas de hoy." },
        iconPath: "/icon.svg",
        jobs: {},
        mcp: null,
      },
    });
  });

  it("no package.json, or not JSON", () => {
    expect(codes(valid({ "/package.json": undefined }))).toEqual(["no_package_json"]);
    expect(codes(valid({ "/package.json": "{nope" }))).toEqual(["bad_json"]);
  });

  it("placement missing or not one of the two", () => {
    expect(codes(valid({ "/package.json": pkg({ openlen: {} }) }))).toContain("no_placement");
    expect(codes(valid({ "/package.json": pkg({ openlen: { tool: { placement: "sidebar" } } }) }))).toContain("bad_placement");
  });

  it("the exports the display record needs", () => {
    expect(codes(valid({ "/package.json": pkg({ exports: { "./icon": "./icon.svg" } }) }))).toContain("no_locale_export");
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json" } }) }))).toContain("no_icon_export");
  });

  it("the person's locale and English both need a title and a description", () => {
    const r = read(valid({ "/locale/es.json": undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContainEqual({ code: "missing_meta", file: "/locale/es.json" });
    expect(codes(valid({ "/locale/en.json": meta("", "x") }))).toContain("missing_meta");
    expect(codes(valid(), "en")).toEqual([]);
  });

  it("titles over 60 and descriptions over 200 characters", () => {
    expect(codes(valid({ "/locale/en.json": meta("x".repeat(61), "ok") }))).toContain("meta_too_long");
    expect(codes(valid({ "/locale/en.json": meta("ok", "x".repeat(201)) }))).toContain("meta_too_long");
  });

  it("the icon must exist, be small enough, of an image type, inside the package", () => {
    expect(codes(valid({ "/icon.svg": undefined }))).toContain("no_icon");
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(ICON_MAX_BYTES)}</svg>`;
    expect(codes(valid({ "/icon.svg": big }))).toContain("icon_too_big");
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "https://x/y.png" } }) }))).toContain(
      "icon_bad_type",
    );
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.gif" } }), "/icon.gif": "GIF89a" }))).toContain(
      "icon_bad_type",
    );
  });

  it("an .svg that isn't an image", () => {
    expect(codes(valid({ "/icon.svg": "<html><body>hi</body></html>" }))).toContain("icon_not_an_image");
  });

  it("the skeleton's placeholder icon is refused", () => {
    expect(codes(valid(), "es", sha(SVG))).toEqual(["icon_is_placeholder"]);
  });

  it("a binary icon kept as a blob pointer is judged by its declared size and its extension", () => {
    const pointer = (size: number) => makePointer({ sha256: "a".repeat(64), size, gitOid: "b".repeat(40) });
    const png = (p: string) => valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.png" } }), "/icon.svg": undefined, "/icon.png": p });
    expect(codes(png(pointer(1000)))).toEqual([]);
    expect(codes(png(pointer(ICON_MAX_BYTES + 1)))).toContain("icon_too_big");
  });

  // PHASE 3 (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): a tool declares its jobs, each a script of
  // its own, with a ceiling of minutes; its title lives in the display record.
  describe("jobs", () => {
    const withJobs = (jobs: unknown, over: Record<string, string | undefined> = {}) =>
      valid({
        "/package.json": pkg({ openlen: { tool: { placement: "rail", jobs } } }),
        "/jobs/pdf.py": "print('ok')",
        "/locale/en.json": JSON.stringify({ meta: { title: "Today's bookings", description: "See and confirm today's bookings." }, jobs: { pdf: "Make the PDF" } }),
        "/locale/es.json": JSON.stringify({ meta: { title: "Reservas de hoy", description: "Ver y confirmar las reservas de hoy." }, jobs: { pdf: "Hacer el PDF" } }),
        ...over,
      });

    it("a declared job is read with its script, its titles, and 10 minutes by default", () => {
      const r = read(withJobs({ pdf: { script: "jobs/pdf.py" } }));
      expect(r.ok && r.manifest.jobs).toEqual({ pdf: { script: "/jobs/pdf.py", maxMinutes: 10, titles: { en: "Make the PDF", es: "Hacer el PDF" } } });
      const r2 = read(withJobs({ pdf: { script: "jobs/pdf.py", maxMinutes: 30 } }));
      expect(r2.ok && r2.manifest.jobs.pdf?.maxMinutes).toBe(30);
    });

    it("no jobs field reads as none", () => {
      const r = read(valid());
      expect(r.ok && r.manifest.jobs).toEqual({});
    });

    it("each problem a job can have", () => {
      expect(codes(withJobs({ Pdf: { script: "jobs/pdf.py" } }))).toContain("job_bad_name");
      expect(codes(withJobs({ pdf: { script: "jobs/other.py" } }))).toContain("job_script_missing");
      expect(codes(withJobs({ pdf: { script: "jobs/run.sh" } }, { "/jobs/run.sh": "echo" }))).toContain("job_script_kind");
      expect(codes(withJobs({ pdf: { script: "../pdf.py" } }))).toContain("job_script_kind");
      expect(codes(withJobs({ pdf: { script: "jobs/pdf.py", maxMinutes: 0 } }))).toContain("job_minutes");
      expect(codes(withJobs({ pdf: { script: "jobs/pdf.py", maxMinutes: 31 } }))).toContain("job_minutes");
      expect(codes(withJobs({ pdf: { script: "jobs/pdf.py", maxMinutes: 2.5 } }))).toContain("job_minutes");
      const noTitle = withJobs({ pdf: { script: "jobs/pdf.py" } }, { "/locale/en.json": meta("Today's bookings", "See and confirm today's bookings."), "/locale/es.json": meta("Reservas de hoy", "Ver y confirmar las reservas de hoy.") });
      expect(codes(noTitle)).toContain("job_title_missing");
    });

    it("at most eight jobs", () => {
      const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`j${i}`, { script: "jobs/pdf.py" }]));
      expect(codes(withJobs(nine))).toContain("job_too_many");
    });
  });

  it("collects every problem before answering", () => {
    expect(codes(valid({ "/package.json": pkg({ openlen: { tool: { placement: "x" } } }), "/icon.svg": undefined }))).toEqual(
      expect.arrayContaining(["bad_placement", "no_icon"]),
    );
  });
});

describe("readToolJobs", () => {
  const files = (jobs: unknown, extra: Record<string, string> = {}) => ({
    "/package.json": JSON.stringify({ openlen: { tool: { placement: "rail", jobs } } }),
    "/locale/en.json": JSON.stringify({ jobs: { a: "Export", b: "Other" } }),
    ...extra,
  });

  it("the jobs a version can run: declared well and with their script present", async () => {
    const { readToolJobs } = await import("./manifest");
    const jobs = readToolJobs(files({ a: { script: "./jobs/a.mjs", maxMinutes: 5 }, b: { script: "./jobs/b.py" }, "Bad Name": { script: "./jobs/c.mjs" } }, { "/jobs/a.mjs": "1" }));
    expect(jobs).toEqual({ a: { script: "/jobs/a.mjs", maxMinutes: 5, titles: { en: "Export" } } });
  });

  it("no package.json, or none declared: none", async () => {
    const { readToolJobs } = await import("./manifest");
    expect(readToolJobs({})).toEqual({});
    expect(readToolJobs(files(undefined))).toEqual({});
  });
});

// PHASE 4 (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): the tool names its MCP server — DeepSeek's
// `serverName`, and the Edge Function that serves it where DeepSeek has a `url`.
describe("the MCP server a tool names", () => {
  const withMcp = (mcp: unknown, extra: Record<string, string> = { "/supabase/functions/mcp/index.ts": "Deno.serve(() => new Response())" }) =>
    valid({ "/package.json": pkg({ openlen: { tool: { placement: "rail", mcp } } }), ...extra });

  it("serverName and function, when the function's entry exists", () => {
    const r = read(withMcp({ serverName: "empleados", function: "mcp" }));
    expect(r.ok && r.manifest.mcp).toEqual({ serverName: "empleados", function: "mcp" });
  });

  it("none declared: null", () => {
    const r = read(valid());
    expect(r.ok && r.manifest.mcp).toBeNull();
  });

  it("a serverName Len's tool names can't carry: mcp_bad_name", () => {
    expect(codes(withMcp({ serverName: "Empleados", function: "mcp" }))).toContain("mcp_bad_name");
    expect(codes(withMcp({ serverName: "x".repeat(25), function: "mcp" }))).toContain("mcp_bad_name");
    expect(codes(withMcp({ serverName: "emple ados", function: "mcp" }))).toContain("mcp_bad_name");
  });

  it("a function with no index.ts, index.tsx or index.js: mcp_function_missing", () => {
    expect(codes(withMcp({ serverName: "empleados", function: "mcp" }, {}))).toContain("mcp_function_missing");
    expect(codes(withMcp({ serverName: "empleados", function: "mcp" }, { "/supabase/functions/mcp/index.js": "x" }))).toEqual([]);
    expect(codes(withMcp({ serverName: "empleados" }))).toContain("mcp_function_missing");
  });
});
