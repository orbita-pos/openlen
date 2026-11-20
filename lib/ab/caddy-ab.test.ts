// @vitest-environment node
//
// The A/B part of infra/caddy/Caddyfile (spec: infra/AB_TESTING_RUNBOOK.md, review of 19/11 items
// 5, 7, 8, 9, 10). The behaviours were measured against a real Caddy 2.11.4 and the real sidecar;
// this file pins the text they depend on, so a later edit cannot undo them without a red test:
//   - a sidecar that is down, hung or slow must not cost the site (fail-open);
//   - the experiment's own files are 404 from Caddy itself;
//   - only the sidecar's answer carries its headers (no `header` + `reverse_proxy` duplicates);
//   - a file the sidecar decides is served by Caddy's own file server.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CADDYFILE = join(process.cwd(), "infra", "caddy", "Caddyfile");
const text = readFileSync(CADDYFILE, "utf8");
const sinComentarios = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
const start = text.indexOf("\n*.openlen.app {");
const block = sinComentarios(text.slice(start, text.indexOf("\nlen.openlen.com {")));

/** The body of a `{ … }` that opens at `from` (the brace's own line indentation closes it). */
function body(src: string, from: number): string {
  const open = src.indexOf("{", from);
  const indent = /([\t ]*)[^\n]*$/.exec(src.slice(0, open))![1]!;
  const close = src.indexOf(`\n${indent}}`, open);
  return src.slice(open + 1, close);
}

const matcher = (name: string) => body(block, block.indexOf(`\t@${name} {`));
const PASSTHROUGH = (m: string) => /^\s*not path (\/c\/\* .*)$/m.exec(m)?.[1];

describe("Caddy: A/B testing", () => {
  it("the sidecar block exists and the old catch-all is gone", () => {
    expect(block).not.toContain("@has_ab");
    for (const name of ["ab_page", "ab_asset", "ab_internal", "ab_delegated", "ab_probed"]) {
      expect(block, name).toContain(`@${name} `);
    }
  });

  it("looks for the manifest under the reserved openlen/ root", () => {
    expect(block).not.toMatch(/try_files \/ab\.json/);
    for (const name of ["ab_page", "ab_asset"]) {
      expect(matcher(name), name).toMatch(/try_files \/openlen\/ab\.json/);
    }
  });

  it("🔴 the experiment's own files are a 404 of Caddy's, written however the path is", () => {
    expect(block).toMatch(/@ab_internal path \/openlen\/ab\.json \/openlen\/ab\.json\/ \/openlen\/ab \/openlen\/ab\/\*/);
    const handle = body(block, block.indexOf("\thandle @ab_internal {"));
    expect(handle).toContain("error 404");
    // It comes before the handles that could answer such a path.
    expect(block.indexOf("handle @ab_internal")).toBeLessThan(block.indexOf("handle @ab_delegated"));
  });

  it("only a site that has a manifest, and never a lienzo host or a proxied route, reaches the sidecar", () => {
    for (const name of ["ab_page", "ab_asset"]) {
      const m = matcher(name);
      expect(m, name).toContain("not header_regexp Host ^lienzo-");
    }
    // The same proxied-route list as @doc (a route added to one and not the other is a bug).
    const doc = PASSTHROUGH(matcher("doc"));
    expect(doc).toBeDefined();
    expect(PASSTHROUGH(matcher("ab_page"))).toBe(doc);
    expect(PASSTHROUGH(matcher("ab_asset"))).toBe(doc);
  });

  it("a page is delegated by shape (no extension, or .html/.htm), a file is its complement", () => {
    const pageShape = /path_regexp ab_page_shape `([^`]+)`/.exec(matcher("ab_page"))?.[1];
    const assetShape = /not path_regexp ab_asset_shape `([^`]+)`/.exec(matcher("ab_asset"))?.[1];
    expect(pageShape).toBeDefined();
    expect(assetShape).toBe(pageShape);
    // The shape agrees with crates/edge `path_has_non_html_extension` (Go's regexp is RE2, as is
    // Rust's; JS reads the (?i) flag off the front).
    const re = new RegExp(pageShape!.replace(/^\(\?i\)/, ""), "i");
    const pages = ["/", "/about", "/about/", "/a/b", "/es", "/v1.2/pricing", "/index.html", "/a/b.html", "/A.HTM", "/x.html/", "/.well-known/x"];
    const files = ["/css/site.css", "/.hidden", "/.well-known/security.txt", "/foo.", "/data.v2", "/a.b/", "/img/a.PNG", "/x.htmlx"];
    for (const p of pages) expect(re.test(p), `${p} is a page`).toBe(true);
    for (const p of files) expect(re.test(p), `${p} is a file`).toBe(false);
  });

  it("🔴 FAIL OPEN: the sidecar is given 300 ms to be reached and 3 s to answer, and a failure takes it out of rotation", () => {
    for (const handle of ["ab_delegated", "ab_probed"]) {
      const h = body(block, block.indexOf(`\thandle @${handle} {`));
      expect(h, handle).toContain("reverse_proxy 127.0.0.1:8085");
      expect(h, handle).toContain("dial_timeout 300ms");
      expect(h, handle).toContain("response_header_timeout 3s");
      expect(h, handle).toContain("fail_duration 10s");
      expect(h, handle).toContain("max_fails 1");
    }
  });

  it("🔴 FAIL OPEN: handle_errors serves CONTROL from disk on 502/503/504, only for what was delegated", () => {
    const errors = body(block, block.indexOf("\thandle_errors {"));
    const m = /@ab_failover expression (.+)/.exec(errors)?.[1] ?? "";
    expect(m).toMatch(/\{http\.error\.status_code\} in \[502, 503, 504\]/);
    expect(m).toContain('{http.vars.ab_delegated} == "sidecar"');
    expect(m).toContain('{http.vars.ab_probe} == "sidecar"');
    const failover = body(errors, errors.indexOf("\t\thandle @ab_failover {"));
    // The same try_files as the static branch, a real file server, a 200 and no cache.
    expect(failover).toContain("try_files {path} {path}/index.html /index.html");
    expect(failover).toContain("root * /var/www/openlen/{labels.2}/current");
    expect(failover).toMatch(/file_server \{\s*status 200\s*\}/);
    expect(failover).toContain('header Cache-Control "private, no-store"');
    // The branded 404 is still there, for everything else.
    expect(errors).toContain("handle @notfound");
  });

  it("the failover sends the same security headers as the site", () => {
    const site = /header \{([\s\S]*?)\n\t\}/.exec(block)![1]!;
    const errors = body(block, block.indexOf("\thandle_errors {"));
    const failover = /header \{([\s\S]*?)\n\t\t\t\}/.exec(errors)![1]!;
    const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).sort();
    expect(lines(failover)).toEqual(lines(site));
  });

  it("the failover types a file the way the static branch does", () => {
    const errors = body(block, block.indexOf("\thandle_errors {"));
    const typed = (src: string, prefix: string) =>
      [...src.matchAll(new RegExp(`header @${prefix}(\\w+) Content-Type "([^"]+)"`, "g"))]
        .map((m) => `${m[1]}=${m[2]}`)
        .sort();
    const site = typed(block.slice(0, block.indexOf("\thandle_errors {")), "");
    const failover = typed(errors, "ab_");
    expect(failover.length).toBeGreaterThanOrEqual(9);
    // Every type the site sets, the failover sets (it may have no more).
    expect(site.filter((t) => failover.includes(t))).toEqual(failover);
  });

  it("🔴 no duplicated headers: @doc skips a page the sidecar answers, and no other header matcher can match a page", () => {
    expect(matcher("doc")).toContain('not expression {http.vars.ab_delegated} == "sidecar"');
    const names = [...block.matchAll(/^\theader @(\w+) (?:Cache-Control|Content-Type) /gm)]
      .map((m) => m[1]!)
      .filter((n) => !n.startsWith("ab_") && n !== "doc");
    expect(names.length).toBeGreaterThanOrEqual(11);
    // A page has no extension (or .html/.htm). Each of these names an extension, or is a path the
    // sidecar is never asked about: the paths @ab_page itself leaves out (/assets/*, /uploads/* and
    // the whole of /openlen/*, which holds no pages), read off the Caddyfile, not assumed.
    const leftOut = [...matcher("ab_page").matchAll(/^\t\tnot path (.+)$/gm)]
      .flatMap((m) => m[1]!.split(/\s+/))
      .filter((e) => e.endsWith("/*"))
      .map((e) => e.slice(0, -1));
    expect(leftOut).toContain("/openlen/");
    for (const n of names) {
      const patterns = (/^\t\tpath (.+)$/m.exec(matcher(n))?.[1] ?? "").split(/\s+/);
      expect(patterns.length, `@${n}`).toBeGreaterThan(0);
      for (const p of patterns) {
        const ok = /^\*\.[a-z0-9]+$/.test(p) && !/^\*\.html?$/.test(p);
        const excluded = leftOut.some((e) => p.startsWith(e));
        expect(ok || excluded, `@${n}: ${p}`).toBe(true);
      }
    }
  });

  it("a delegated page is marked before the header matchers run, and the variable is a string", () => {
    expect(block).toContain("vars @ab_page ab_delegated sidecar");
    expect(block).toContain("vars @ab_asset ab_probe sidecar");
    // Caddy's `vars` turns 1 into a number and true into a boolean; only a string compares to "sidecar".
    expect(block).not.toMatch(/ab_delegated (1|true)\b/);
  });

  it("a file is DECIDED by the sidecar and served by Caddy: Range, 304 and the 404 page stay its own", () => {
    const h = body(block, block.indexOf("\thandle @ab_probed {"));
    expect(h).toContain("@ab_serve header X-Openlen-Serve *");
    const serve = body(h, h.indexOf("handle_response @ab_serve {"));
    expect(serve).toContain('header Cache-Control "no-store"');
    expect(serve).toContain('header Vary "Cookie"');
    expect(serve).toContain("rewrite * {rp.header.X-Openlen-Serve}");
    expect(serve).toContain("file_server");
    // Not decided (or anything the sidecar answers badly): served as for any site.
    const pass = body(h, h.indexOf("handle_response @ab_pass {"));
    expect(pass).toContain("try_files {path} {path}/index.html /index.html");
    expect(h).toContain("@ab_pass status 2xx 3xx 4xx 5xx");
    // The order matters: the decided file is tried first.
    expect(h.indexOf("handle_response @ab_serve")).toBeLessThan(h.indexOf("handle_response @ab_pass"));
  });

  it("🔴 an error of the sidecar on a page (4xx or 5xx) is replaced by control, as master would serve it", () => {
    // A sidecar that cannot read the release answers 404 (400 for a path that is not UTF-8): that
    // used to reach the visitor as a plain-text error on every page of the site.
    const h = body(block, block.indexOf("\thandle @ab_delegated {"));
    expect(h).toContain("@ab_page_bad status 4xx 5xx");
    const control = body(h, h.indexOf("handle_response @ab_page_bad {"));
    expect(control).toContain('header Cache-Control "private, no-store"');
    expect(control).toContain("try_files {path} {path}/index.html /index.html");
    expect(control).toContain("root * /var/www/openlen/{labels.2}/current");
  });

  it("🔴 a 5xx of the sidecar on a file serves control NOT stored, never with Caddy's normal caching", () => {
    const h = body(block, block.indexOf("\thandle @ab_probed {"));
    expect(h).toContain("@ab_file_5xx status 5xx");
    const control = body(h, h.indexOf("handle_response @ab_file_5xx {"));
    expect(control).toContain('header Cache-Control "private, no-store"');
    expect(control).toContain("try_files {path} {path}/index.html /index.html");
    // Before the catch-all that serves it as for any site, and after the decided file.
    expect(h.indexOf("handle_response @ab_file_5xx")).toBeLessThan(h.indexOf("handle_response @ab_pass"));
    expect(h.indexOf("handle_response @ab_serve")).toBeLessThan(h.indexOf("handle_response @ab_file_5xx"));
  });

  it("🔴 openlen/ is never delegated as a page (its figure engine would leave with two Cache-Control)", () => {
    expect(matcher("ab_page")).toMatch(/^\t\tnot path \/openlen\/\*$/m);
  });

  it("the systemd unit runs the sidecar where Caddy looks for it, and binds nothing else", () => {
    const unit = readFileSync(join(process.cwd(), "infra", "edge", "openlen-ab-sidecar.service"), "utf8");
    const live = sinComentarios(unit);
    expect(live).toContain("ExecStart=/usr/local/bin/openlen-edge --ab-sidecar");
    const bind = /OPENLEN_EDGE_AB_LOOPBACK_BIND=(\S+)/.exec(live)?.[1];
    expect(bind).toBe("127.0.0.1:8085");
    // The address Caddy proxies to is the address the unit binds.
    for (const handle of ["ab_delegated", "ab_probed"]) {
      expect(body(block, block.indexOf(`\thandle @${handle} {`))).toContain(`reverse_proxy ${bind}`);
    }
    // No privileged port, no capability, no TLS material; nothing orders it behind Caddy or the app.
    expect(live).not.toMatch(/CAP_NET_BIND_SERVICE/);
    expect(live).not.toMatch(/letsencrypt|DATABASE_URL|ACME/);
    expect(live).not.toMatch(/^(Requires|BindsTo|PartOf)=/m);
    expect(live).not.toMatch(/^After=.*(caddy|openlen-app)/m);
    expect(live).toMatch(/^IPAddressAllow=localhost$/m);
    expect(live).toMatch(/^StartLimitIntervalSec=0$/m);
  });

  it("the handles it adds name no folder root (the reserved-roots test follows the Caddyfile)", () => {
    const roots = [...block.matchAll(/handle(?:_path)? \/([^/\s{*]+)/g)].map((m) => m[1]!);
    for (const r of roots) expect(r).not.toBe("openlen");
  });

  const hasCaddy = (() => {
    try {
      execFileSync("caddy", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasCaddy)("`caddy adapt` accepts the Caddyfile", () => {
    const out = execFileSync("caddy", ["adapt", "--config", CADDYFILE, "--adapter", "caddyfile"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const json = JSON.parse(out) as { apps: { http: { servers: Record<string, { errors?: { routes: unknown[] } }> } } };
    const servers = Object.values(json.apps.http.servers);
    expect(servers.length).toBeGreaterThan(0);
    // A site with an error handler for the failover exists.
    expect(servers.some((s) => (s.errors?.routes.length ?? 0) > 0)).toBe(true);
    expect(out).toContain("openlen/ab.json");
  });
});
