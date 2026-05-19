// HTTP-level sanity smoke for the marketing + auth + workspace surfaces.
// Verifies each route returns the status code we expect, plus a tiny
// content check for things that should appear in the body.
//
// Run AFTER `npm run dev` (or `npm run start`) is up on $BASE.
//
// Usage: BASE=http://localhost:3000 node scripts/sanity-smoke.mjs

const BASE = process.env.BASE || "http://localhost:3000";

interface Check {
  name: string;
  path: string;
  method?: string;
  body?: string;
  contentType?: string;
  expect: number | number[];
  /** Substring(s) that MUST appear in the response body. */
  must?: string[];
  /** Substring(s) that MUST NOT appear. */
  mustNot?: string[];
}

const checks: Check[] = [
  // --- Public marketing pages ---
  { name: "Home", path: "/", expect: 200, must: ["OpenLen", "AI-built"] },
  {
    name: "Templates gallery",
    path: "/templates",
    expect: 200,
    must: ["TEMPLATES CURADAS", "Mirror"],
  },
  {
    name: "Templates detail (anchor)",
    path: "/templates/anchor",
    expect: 200,
    // React separates interpolated `{slug}` from the `.openlen.com` literal
    // with an HTML comment, so search for the slug and the literal each
    // independently rather than the concatenated form.
    must: ["Anchor", ".openlen.com"],
  },
  {
    name: "Templates detail (404 for unknown)",
    path: "/templates/this-id-does-not-exist",
    expect: 404,
  },

  // --- SEO files ---
  {
    name: "robots.txt",
    path: "/robots.txt",
    expect: 200,
    must: ["Sitemap:", "User-Agent: *"],
    mustNot: ["<!DOCTYPE", "<html"],
  },
  {
    name: "sitemap.xml",
    path: "/sitemap.xml",
    expect: 200,
    must: ["/templates", "openlen.com"],
  },

  // --- Auth pages (no session required) ---
  { name: "Login", path: "/login", expect: 200, must: ["password"] },
  { name: "Register", path: "/register", expect: 200 },
  { name: "Forgot", path: "/forgot", expect: 200 },

  // --- Iframe-served curated HTML (covered by /templates/ public prefix) ---
  {
    name: "Curated iframe (anchor)",
    path: "/templates/curated/anchor.html",
    expect: 200,
    must: ["<!doctype html>"],
  },

  // --- Gated routes redirect to login when unauthenticated ---
  {
    name: "Projects (gated -> 307)",
    path: "/projects",
    expect: 307,
  },
  {
    name: "new-v2 (gated -> 307)",
    path: "/new-v2",
    expect: 307,
  },

  // --- API endpoints reject anonymous correctly ---
  {
    name: "POST /api/projects/from-template (anon -> 401/403)",
    path: "/api/projects/from-template",
    method: "POST",
    body: JSON.stringify({ templateId: "anchor", title: "Test" }),
    contentType: "application/json",
    expect: [401, 403, 307],
  },
  {
    name: "POST /api/projects/from-html (anon -> 401/403)",
    path: "/api/projects/from-html",
    method: "POST",
    body: JSON.stringify({ html: "<!doctype html><h1>hi</h1>", title: "T" }),
    contentType: "application/json",
    expect: [401, 403, 307],
  },
  {
    // Regression test for the SSRF fix in app/api/export/zip/route.ts —
    // anon must NOT reach downloadImage(). 401 is correct, 200 means the
    // auth gate was removed.
    name: "POST /api/export/zip (anon -> 401)",
    path: "/api/export/zip",
    method: "POST",
    body: JSON.stringify({}),
    contentType: "application/json",
    expect: [401, 403],
  },
];

interface Result {
  name: string;
  ok: boolean;
  status: number;
  msg: string;
}

async function main() {
const results: Result[] = [];

for (const c of checks) {
  const url = `${BASE}${c.path}`;
  try {
    const headers: Record<string, string> = {};
    if (c.contentType) headers["content-type"] = c.contentType;
    const res = await fetch(url, {
      method: c.method || "GET",
      headers,
      body: c.body,
      redirect: "manual",
    });
    const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
    const statusOk = expected.includes(res.status);

    let bodyOk = true;
    let bodyMsg = "";
    if (c.must || c.mustNot) {
      const body = await res.text();
      for (const needle of c.must || []) {
        if (!body.includes(needle)) {
          bodyOk = false;
          bodyMsg = `missing "${needle.slice(0, 40)}"`;
          break;
        }
      }
      if (bodyOk) {
        for (const blocked of c.mustNot || []) {
          if (body.includes(blocked)) {
            bodyOk = false;
            bodyMsg = `contained forbidden "${blocked.slice(0, 40)}"`;
            break;
          }
        }
      }
    }

    const ok = statusOk && bodyOk;
    const statusMsg = statusOk
      ? `${res.status} OK`
      : `${res.status} (expected ${expected.join("|")})`;
    results.push({
      name: c.name,
      ok,
      status: res.status,
      msg: ok ? statusMsg : `${statusMsg}${bodyMsg ? " · " + bodyMsg : ""}`,
    });
  } catch (err) {
    results.push({
      name: c.name,
      ok: false,
      status: 0,
      msg: `fetch error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

console.log("\n========== SANITY SMOKE ==========");
for (const r of results) {
  const icon = r.ok ? "[ok]" : "[FAIL]";
  console.log(`  ${icon} ${r.name} — ${r.msg}`);
}
console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} failed` : ""}`);
if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
