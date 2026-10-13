// Reading an esm.sh module: what it imports (esm.sh writes its own modules as
// absolute paths, "/three@0.186.1/es2022/three.mjs"), which exact versions its
// paths name (for the gate), and which Node-only polyfills it pulls in.
import { init, parse } from "es-module-lexer";

export interface ScannedModule {
  readonly absolute: readonly string[];
  readonly relative: readonly string[];
  readonly bare: readonly string[];
}

export async function scanModule(code: string): Promise<ScannedModule> {
  await init;
  const [imports] = parse(code);
  const absolute = new Set<string>();
  const relative = new Set<string>();
  const bare = new Set<string>();
  for (const imp of imports) {
    const spec = imp.specifier;
    if (typeof spec !== "string" || spec === "") continue;
    if (spec.startsWith("/") || /^https?:\/\//.test(spec)) absolute.add(spec);
    else if (spec.startsWith("./") || spec.startsWith("../")) relative.add(spec);
    else bare.add(spec);
  }
  return { absolute: [...absolute], relative: [...relative], bare: [...bare] };
}

const VERSIONED = /\/((?:@[^/@?]+\/)?[^/@?]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=[/?]|$)/g;

export function packageVersionsIn(url: string): { name: string; version: string }[] {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  return [...path.matchAll(VERSIONED)].map((m) => ({ name: m[1]!, version: m[2]! }));
}

// esm.sh's polyfills for these throw (or do nothing) in a browser.
const NODE_ONLY = new Set(["fs", "fs/promises", "child_process", "net", "tls", "dgram", "cluster", "worker_threads", "http2", "inspector", "v8", "vm", "module", "readline", "repl"]);

export function nodeOnlyBuiltinsIn(urls: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const url of urls) {
    const m = /^\/node\/([a-z_/]+)\.mjs(?:\?|$)/.exec(url.replace(/^https?:\/\/[^/]+/, ""));
    if (m && NODE_ONLY.has(m[1]!)) found.add(m[1]!);
  }
  return [...found].sort();
}
