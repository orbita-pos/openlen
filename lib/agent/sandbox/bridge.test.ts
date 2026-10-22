import { describe, expect, it, vi } from "vitest";

import { answerBridgeRequest, routeBoxCommand, type BridgeHandlers } from "./bridge";

const FN = "https://x.openlen.app/functions/v1";

describe("routeBoxCommand", () => {
  it.each([
    ["git", ["status"], true, { kind: "git" }],
    ["git", ["log"], false, { kind: "git" }],
    ["supabase", ["db", "push"], true, { kind: "supabase" }],
    ["stripe", ["products", "list"], false, { kind: "stripe" }],
    ["stripe", ["trigger", "invoice.paid"], true, { kind: "stripe" }],
    ["tsc", ["--noEmit"], true, { kind: "app", program: "tsc", args: ["--noEmit"] }],
    ["eslint", ["."], true, { kind: "app", program: "eslint", args: ["."] }],
    ["vitest", ["run"], true, { kind: "app", program: "test", args: ["run"] }],
    ["npx", ["tsc", "--noEmit"], true, { kind: "app", program: "tsc", args: ["--noEmit"] }],
    ["npx", ["-y", "vitest", "run"], true, { kind: "app", program: "test", args: ["run"] }],
    ["npm", ["run", "build"], true, { kind: "app", program: "build", args: [] }],
    ["npm", ["run", "lint"], true, { kind: "app", program: "eslint", args: ["."] }],
    ["npm", ["run", "typecheck"], true, { kind: "app", program: "tsc", args: ["--noEmit"] }],
    ["npm", ["test"], true, { kind: "app", program: "test", args: [] }],
    ["npm", ["run", "test:unit", "--", "a"], true, { kind: "app", program: "test", args: ["a"] }],
    ["npm", ["install", "zod"], true, { kind: "app", program: "npm-install", args: ["zod"] }],
    ["npm", ["rm", "zod"], true, { kind: "app", program: "npm-uninstall", args: ["zod"] }],
    ["npm", ["ls"], true, { kind: "app", program: "npm-ls", args: [] }],
    ["npm", ["run", "dev"], true, { kind: "passthrough" }],
    ["npx", ["prettier", "."], true, { kind: "passthrough" }],
    ["tsc", [], false, { kind: "passthrough" }],
    ["npm", ["install", "zod"], false, { kind: "passthrough" }],
    ["curl", ["-sS", "https://example.com"], true, { kind: "passthrough" }],
    ["curl", ["-X", "POST", `${FN}/hola`], true, { kind: "functions-curl" }],
  ] as const)("routes %s %j (app: %s)", (program, args, isApp, route) => {
    expect(routeBoxCommand(program, args, { isApp, functionsUrls: [FN] })).toEqual(route);
  });
});

const files = { "/index.html": "<h1>nueva</h1>" };

describe("answerBridgeRequest", () => {
  it("a git answer carries the files it wrote, for the box to get before the command goes on", async () => {
    const git = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, write: { "/index.html": "<h1>vieja</h1>" } }));
    const r = await answerBridgeRequest({ id: "1", program: "git", args: ["restore", "index.html"], cwd: "/" }, { git }, files);
    expect(git).toHaveBeenCalledWith(["restore", "index.html"], "/", files);
    expect(r).toEqual({ stdout: "", stderr: "", exitCode: 0, files: { "/index.html": "<h1>vieja</h1>" } });
  });

  it("supabase's new and deleted files come back as files", async () => {
    const supabase = vi.fn(async () => ({ stdout: "ok\n", stderr: "", exitCode: 0, escribir: { "/supabase/migrations/2_b.sql": "x" }, borrar: ["/supabase/a.sql"] }));
    const r = await answerBridgeRequest({ id: "1", program: "supabase", args: ["db", "pull"], cwd: "/" }, { supabase }, files);
    expect(r).toMatchObject({ exitCode: 0, files: { "/supabase/migrations/2_b.sql": "x", "/supabase/a.sql": null } });
  });

  it("stripe is answered by OpenLen, never by a real CLI in the box (the key never enters it)", async () => {
    const stripe = vi.fn(async () => ({ stdout: "{}\n", stderr: "", exitCode: 0 }));
    const r = await answerBridgeRequest({ id: "1", program: "stripe", args: ["products", "list"], cwd: "/" }, { stripe }, files);
    expect(stripe).toHaveBeenCalledWith(["products", "list"], { signal: undefined });
    expect(r).toEqual({ stdout: "{}\n", stderr: "", exitCode: 0, files: {} });
    expect(await answerBridgeRequest({ id: "2", program: "stripe", args: ["products", "list"], cwd: "/" }, {}, files)).toEqual({
      stdout: "",
      stderr: "stripe: not available in this project\n",
      exitCode: 127,
      files: {},
    });
  });

  it("an app check runs OpenLen's checker with the tree", async () => {
    const run = vi.fn(async () => ({ stdout: "Found 0 errors.\n", stderr: "", exitCode: 0 }));
    const handlers: BridgeHandlers = { appTools: { run } };
    const r = await answerBridgeRequest({ id: "1", program: "npx", args: ["tsc", "--noEmit"], cwd: "/" }, handlers, files);
    expect(run).toHaveBeenCalledWith("tsc", ["--noEmit"], files, undefined, undefined);
    expect(r).toEqual({ stdout: "Found 0 errors.\n", stderr: "", exitCode: 0, files: {} });
  });

  it("without the handler, the real program runs", async () => {
    expect(await answerBridgeRequest({ id: "1", program: "git", args: ["status"], cwd: "/" }, {}, files)).toEqual({ passthrough: true });
    expect(await answerBridgeRequest({ id: "1", program: "npm", args: ["run", "dev"], cwd: "/" }, {}, files)).toEqual({ passthrough: true });
  });

  it("curl to the project's Edge Functions goes through OpenLen's door, with the box's files and cwd", async () => {
    const functionsCurl = vi.fn(async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0, files: { "/out.json": '{"ok":true}' } }));
    const args = ["-s", "-X", "POST", `${FN}/hola`, "-d", "@body.json", "-o", "/out.json"];
    const r = await answerBridgeRequest({ id: "1", program: "curl", args, cwd: "/data" }, { functionsUrls: [FN], functionsCurl }, files);
    expect(functionsCurl).toHaveBeenCalledWith(args, "/data", files, { signal: undefined });
    expect(r).toEqual({ stdout: '{"ok":true}', stderr: "", exitCode: 0, files: { "/out.json": '{"ok":true}' } });
  });

  it("curl to anything else is the box's real curl", async () => {
    const functionsCurl = vi.fn();
    const r = await answerBridgeRequest({ id: "1", program: "curl", args: ["https://registry.npmjs.org/"], cwd: "/" }, { functionsUrls: [FN], functionsCurl }, files);
    expect(r).toEqual({ passthrough: true });
    expect(functionsCurl).not.toHaveBeenCalled();
  });

  it("an aborted turn stops waiting for a handler", async () => {
    const git = vi.fn(() => new Promise<never>(() => {}));
    const ctrl = new AbortController();
    const started = Date.now();
    const p = answerBridgeRequest({ id: "1", program: "git", args: ["status"], cwd: "/" }, { git }, files, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(100);
  });
});
