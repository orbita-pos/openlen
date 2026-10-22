// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { TerminalBackend } from "@/lib/agent/terminal/backend";
import { TerminalDeLen, type SalidaDeUnComando } from "@/lib/agent/terminal/terminal";
import type { CurlRequest } from "@/lib/functions/curl-types";

import { functionsCurlThrough } from "./functions-curl";

function fakeTerminal(o: { run: (command: string, files: Record<string, string>) => Promise<SalidaDeUnComando> }) {
  const log = { ran: [] as string[], given: null as Record<string, string> | null, closed: false };
  const make = (files: Record<string, string>): TerminalBackend => {
    log.given = files;
    return {
      arrancada: true,
      async ejecutar(command) {
        log.ran.push(command);
        return o.run(command, files);
      },
      async refrescarPerezosos() {},
      async poner() {},
      async cerrar() {
        log.closed = true;
      },
    };
  };
  return { make, log };
}

describe("functionsCurlThrough", () => {
  it("runs the curl in today's terminal over the box's files, at its cwd, and gives back what it wrote", async () => {
    const { make, log } = fakeTerminal({
      run: async (_c, files) => ({ stdout: "ok", stderr: "", exitCode: 0, ficheros: { ...files, "/out.json": "{}" } }),
    });
    const r = await functionsCurlThrough(make)(["-s", "-d", "it's", "https://x/functions/v1/hola"], "/data", { "/index.html": "x" });
    expect(log.given).toEqual({ "/index.html": "x" });
    expect(log.ran).toEqual([`cd '/data' && curl '-s' '-d' 'it'\\''s' 'https://x/functions/v1/hola'`]);
    expect(r).toEqual({ stdout: "ok", stderr: "", exitCode: 0, files: { "/out.json": "{}" } });
    expect(log.closed).toBe(true);
  });

  it("a file the command removed comes back as null", async () => {
    const { make } = fakeTerminal({ run: async () => ({ stdout: "", stderr: "", exitCode: 0, ficheros: {} }) });
    const r = await functionsCurlThrough(make)(["https://x/functions/v1/a"], "/", { "/tmp.json": "x" });
    expect(r.files).toEqual({ "/tmp.json": null });
  });

  it("with today's real terminal: the body comes from the box's file and the call reaches the door", async () => {
    const PREFIX = "https://zyxwvutsrqponmlkjihg.openlen.app/functions/v1/";
    const asked: CurlRequest[] = [];
    const curl = {
      prefixes: [PREFIX],
      call: async (r: CurlRequest) => {
        asked.push(r);
        return { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyB64: Buffer.from('{"message":"Hola Ana"}').toString("base64") };
      },
    };
    const handler = functionsCurlThrough((files) => new TerminalDeLen({ cargarFicheros: async () => files, functionsCurl: async () => curl }));
    const r = await handler(["-s", "-X", "POST", `${PREFIX}hello`, "-d", "@body.json"], "/data", { "/data/body.json": '{"name":"Ana"}' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toBe('{"message":"Hola Ana"}');
    expect(Buffer.from(asked[0]!.bodyB64!, "base64").toString()).toBe('{"name":"Ana"}');
    expect(r.files).toEqual({});
  }, 20_000);

  it("the terminal closes even when the command throws", async () => {
    const { make, log } = fakeTerminal({ run: async () => Promise.reject(new Error("worker died")) });
    await expect(functionsCurlThrough(make)(["https://x/functions/v1/a"], "/", {})).rejects.toThrow("worker died");
    expect(log.closed).toBe(true);
  });
});
