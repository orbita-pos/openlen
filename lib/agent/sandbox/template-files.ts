// The files the box's template carries (spec local 2026-10-21-real-terminal-e2b, §5 and §6),
// generated here so the system folders the manifest skips come from ./paths.ts, not a copy.
//
// - `openlen-manifest`: path → sha256 of the project's files (everything at the root but the system
//   folders and /.openlen, plus the person's memory under /home/user/.len), as JSON.
// - `openlen-bridge <program> [args…]`: the commands OpenLen answers (git, supabase, the app's
//   checks…). It leaves a request in the mailbox, waits for the answer and prints it; or, if the
//   answer is "passthrough", runs the real program. No network to OpenLen: the turn reads the
//   mailbox through E2B (./bridge.ts).
// - one wrapper per bridged program, first in PATH (/opt/openlen/bin).
//
// Python 3 because the box has it and it writes JSON without surprises. `OPENLEN_ROOT` and
// `OPENLEN_BRIDGE_DIR` exist for the tests; in the box they are unset.

import { MAX_FOLDER_FILE_BYTES } from "@/lib/agent/ficheros/folder";

import { NEVER_SYNCED_ANYWHERE, SYSTEM_TOP_LEVEL } from "./paths";

export const BOX_BIN = "/opt/openlen/bin";
export const BRIDGE_DIR = "/run/openlen";

export const BRIDGED_PROGRAMS: readonly string[] = ["git", "supabase", "tsc", "eslint", "vitest", "npm", "npx", "curl"];

/** A manifest entry for a file over the cap: `big:<bytes>:<mtime ns>`, without reading it (it can't be saved anyway). */
export const BIG_FILE_PREFIX = "big:";

export function manifestScript(): string {
  return `import hashlib, json, os, sys

EXCLUDED = set(${JSON.stringify([...SYSTEM_TOP_LEVEL, ".openlen"])})
ANYWHERE = set(${JSON.stringify(NEVER_SYNCED_ANYWHERE)})
MAX_BYTES = ${MAX_FOLDER_FILE_BYTES}
ROOT = os.environ.get("OPENLEN_ROOT", "/")
MEMORY = os.path.join(ROOT, "home", "user", ".len")
out = {}

def add(path):
    if os.path.islink(path) or not os.path.isfile(path):
        return
    key = "/" + os.path.relpath(path, ROOT).replace(os.sep, "/")
    try:
        st = os.stat(path)
        if st.st_size > MAX_BYTES:
            out[key] = "${BIG_FILE_PREFIX}%d:%d" % (st.st_size, st.st_mtime_ns)
            return
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
    except OSError:
        return
    out[key] = h.hexdigest()

def walk(top):
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = [d for d in dirnames if d not in ANYWHERE and not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            add(os.path.join(dirpath, name))

for name in sorted(os.listdir(ROOT)):
    if name in EXCLUDED or name in ANYWHERE:
        continue
    path = os.path.join(ROOT, name)
    if os.path.isdir(path) and not os.path.islink(path):
        walk(path)
    else:
        add(path)
if os.path.isdir(MEMORY):
    walk(MEMORY)
sys.stdout.reconfigure(encoding="utf-8")
json.dump(out, sys.stdout, ensure_ascii=False, sort_keys=True)
`;
}

export function bridgeScript(): string {
  return `import json, os, shutil, sys, time, uuid

BRIDGE = os.environ.get("OPENLEN_BRIDGE_DIR", ${JSON.stringify(BRIDGE_DIR)})
OWN_BIN = ${JSON.stringify(BOX_BIN)}
program, args = sys.argv[1], sys.argv[2:]
rid = uuid.uuid4().hex
request = {"id": rid, "program": program, "args": args, "cwd": os.getcwd()}
tmp = os.path.join(BRIDGE, "requests", "." + rid + ".tmp")
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(request, f)
os.replace(tmp, os.path.join(BRIDGE, "requests", rid + ".json"))

answer = os.path.join(BRIDGE, "responses", rid + ".json")
response = None
while response is None:
    time.sleep(0.05)
    if not os.path.exists(answer):
        continue
    try:
        with open(answer, encoding="utf-8") as f:
            response = json.load(f)
    except ValueError:
        response = None  # still being written
os.remove(answer)

if response.get("passthrough"):
    path = os.pathsep.join(p for p in os.environ.get("PATH", "").split(os.pathsep) if p and os.path.realpath(p) != OWN_BIN)
    real = shutil.which(program, path=path)
    if real is None:
        sys.stderr.write("bash: %s: command not found\\n" % program)
        sys.exit(127)
    os.execv(real, [program] + args)

sys.stdout.write(response.get("stdout", ""))
sys.stdout.flush()
sys.stderr.write(response.get("stderr", ""))
sys.stderr.flush()
sys.exit(int(response.get("exitCode", 0)))
`;
}

/** Playwright, fixed in the template with its Chromium (plan local 2026-10-21-playwright-in-the-box): the
 *  browser a version downloads must be the one it runs, and npx would fetch the newest from the registry. */
export const PLAYWRIGHT_VERSION = "1.63.0";
export const PLAYWRIGHT_DIR = "/opt/openlen/playwright";
export const PLAYWRIGHT_BROWSERS = "/opt/openlen/ms-playwright";
const PLAYWRIGHT_BIN = `${PLAYWRIGHT_DIR}/node_modules/.bin/playwright`;

/** Loaded into every `node` of the box by NODE_OPTIONS (sandbox-terminal.ts). */
export const PLAYWRIGHT_RESOLVER = `${BOX_BIN}/playwright-resolve.cjs`;

/** The template's Playwright for what a PROJECT's file imports or requires (its tests, its config),
 *  ESM included —NODE_PATH only reaches `require`— and also next to a copy of its own, which would
 *  be a second Playwright beside the runner's (measured 21/10 in a real box: «did not expect test()
 *  to be called here»). What a package in node_modules asks for stays its own. CJS through
 *  `_resolveFilename` (Playwright wraps it with its own and calls ours), ESM through registerHooks. */
export function playwrightResolverScript(dir: string = PLAYWRIGHT_DIR): string {
  return `"use strict";
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const DIR = ${JSON.stringify(dir)};
const OURS = /^(@playwright\\/test|playwright|playwright-core)(\\/.*)?$/;
const IN_PACKAGE = /[\\\\/]node_modules[\\\\/]/;
const ours = (specifier, parent) => OURS.test(specifier) && !IN_PACKAGE.test(parent || "");
const asParent = { id: path.join(DIR, "package.json"), filename: path.join(DIR, "package.json"), paths: Module._nodeModulePaths(DIR) };
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolveFilename.call(this, request, ours(request, parent && parent.filename) ? asParent : parent, ...rest);
};
if (typeof Module.registerHooks === "function") {
  const parentURL = pathToFileURL(path.join(DIR, "package.json")).href;
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier, ours(specifier, context.parentURL) ? { ...context, parentURL } : context);
    },
  });
}
`;
}

export function wrapperScript(program: string): string {
  // `npx playwright …` is the template's Playwright, straight: no bridge, no download.
  const playwright = program === "npx" ? `if [ "$1" = "playwright" ]; then shift; exec ${PLAYWRIGHT_BIN} "$@"; fi\n` : "";
  return `#!/bin/sh\n${playwright}exec ${BOX_BIN}/openlen-bridge ${program} "$@"\n`;
}

/** Box path → content and mode, for the template build. */
export function templateFiles(): Record<string, { readonly content: string; readonly mode: number }> {
  const files: Record<string, { content: string; mode: number }> = {
    [`${BOX_BIN}/openlen-manifest`]: { content: `#!/usr/bin/env python3\n${manifestScript()}`, mode: 0o755 },
    [`${BOX_BIN}/openlen-bridge`]: { content: `#!/usr/bin/env python3\n${bridgeScript()}`, mode: 0o755 },
  };
  for (const p of BRIDGED_PROGRAMS) files[`${BOX_BIN}/${p}`] = { content: wrapperScript(p), mode: 0o755 };
  files[`${BOX_BIN}/playwright`] = { content: `#!/bin/sh\nexec ${PLAYWRIGHT_BIN} "$@"\n`, mode: 0o755 };
  files[PLAYWRIGHT_RESOLVER] = { content: playwrightResolverScript(), mode: 0o644 };
  return files;
}
