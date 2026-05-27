// Input loaders for the F1 shadow-soak synthetic load.
//
// Three sources, three semantics:
//   - starter    — 3 HTML files from templates/starter/ (canonical production-
//                  shaped inputs that always exist in a fresh clone).
//   - db         — N rows from projectVersions.html (real user data; only when
//                  DATABASE_URL is set, otherwise [] with a warning).
//   - adversarial — 13 hand-crafted edge cases that probe the gates + the
//                  serializer drift between cheerio and lol-html.
//
// See docs/rust-f1-soak-runbook.md for how the soak run consumes these.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "@/lib/db";
import { projectVersions } from "@/lib/db/schema";

export interface SoakInput {
  /** Stable identifier — used for log grouping. e.g. "starter:mirror",
   *  "db:projectVersion:<uuid>", "adversarial:slot-path-mixed". */
  name: string;
  html: string;
  source: "starter" | "db" | "adversarial";
}

const REPO_ROOT = process.cwd();

export function loadStarterTemplates(): SoakInput[] {
  const dir = join(REPO_ROOT, "templates", "starter");
  if (!existsSync(dir)) {
    console.warn(`[soak/inputs] starter dir not found at ${dir} (cwd=${REPO_ROOT})`);
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  return files.map((f) => ({
    name: `starter:${f.replace(/\.html$/, "")}`,
    html: readFileSync(join(dir, f), "utf8"),
    source: "starter" as const,
  }));
}

export async function loadDbProjectsSample(n: number): Promise<SoakInput[]> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[soak/inputs] DATABASE_URL not set; skipping DB sample (returns 0 inputs).",
    );
    return [];
  }
  try {
    const rows = await db
      .select({ id: projectVersions.id, html: projectVersions.html })
      .from(projectVersions)
      .limit(n);
    return rows.map((r) => ({
      name: `db:projectVersion:${r.id}`,
      html: r.html ?? "",
      source: "db" as const,
    }));
  } catch (err) {
    console.warn(
      "[soak/inputs] DB query failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export function loadAdversarialInputs(): SoakInput[] {
  const baseDoc = (body: string) =>
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Adversarial</title></head><body>${body}</body></html>`;

  // ~100 KB synthetic doc — 800 cards × ~135 bytes each = ~108 KB body.
  const largeBody =
    "<section>" +
    Array.from({ length: 800 }, (_, i) =>
      `<div class="card-${i}"><h3>Item ${i}</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Synthetic filler payload number ${i} repeated.</p></div>`,
    ).join("") +
    "</section>";

  return [
    {
      name: "adversarial:empty",
      html: "",
      source: "adversarial",
    },
    {
      name: "adversarial:slot-path-literal",
      html: baseDoc('<div data-slot-path="hero/headline">Headline</div>'),
      source: "adversarial",
    },
    {
      name: "adversarial:slot-path-mixed-case",
      html: baseDoc('<div DATA-SLOT-PATH="hero/headline">Headline</div>'),
      source: "adversarial",
    },
    {
      name: "adversarial:slot-path-entity-encoded",
      html: baseDoc('<div &#100;ata-slot-path="hero/headline">Headline</div>'),
      source: "adversarial",
    },
    {
      name: "adversarial:slot-path-whitespace-around-equals",
      html: baseDoc('<div data-slot-path  =  "hero/headline">Headline</div>'),
      source: "adversarial",
    },
    {
      name: "adversarial:script-inline-alert",
      html: baseDoc('<script>alert(1)</script><h1>Visible heading</h1>'),
      source: "adversarial",
    },
    {
      name: "adversarial:iframe-src",
      html: baseDoc('<iframe src="https://evil.example.com/x" width="100" height="100"></iframe><p>after</p>'),
      source: "adversarial",
    },
    {
      name: "adversarial:event-handler-attrs",
      html: baseDoc('<button onclick="alert(1)" onmouseover="alert(2)">Click</button>'),
      source: "adversarial",
    },
    {
      name: "adversarial:dangerous-url-schemes",
      html: baseDoc('<a href="javascript:void(0)">js</a><a href="vbscript:msgbox(1)">vb</a><a href="data:text/html,<script>alert(1)</script>">data</a>'),
      source: "adversarial",
    },
    {
      name: "adversarial:meta-refresh",
      html: baseDoc('<meta http-equiv="refresh" content="0; url=https://evil.example.com"><p>visible</p>'),
      source: "adversarial",
    },
    {
      name: "adversarial:large-doc-100kb",
      html: baseDoc(largeBody),
      source: "adversarial",
    },
    {
      name: "adversarial:tailwind-arbitrary-values",
      html: baseDoc(
        '<div class="bg-[rgba(15,15,15,0.72)] max-w-[1240px] text-[#3ECF8E]"><h1 class="text-[clamp(3rem,8vw,6rem)]">Heading</h1><p class="mt-[1.5rem]">Body</p></div>',
      ),
      source: "adversarial",
    },
    {
      name: "adversarial:malformed-unclosed",
      html: '<html><body><div><p>Unclosed paragraph<div><span>Nested mess<section><h1>Heading without closing tags</body>',
      source: "adversarial",
    },
  ];
}
