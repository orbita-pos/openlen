import { describe, expect, it, vi } from "vitest";

import { PAGE_CDNS } from "./box-network";
import { BOX_ALLOW_OUT, e2bDriver, type E2bSandboxLike, type E2bSdkLike } from "./e2b-driver";

function fakeSdk() {
  const box: E2bSandboxLike = {
    sandboxId: "sbx-1",
    commands: {
      run: vi.fn(async () => ({ pid: 7, wait: async () => ({ stdout: "hola\n", stderr: "", exitCode: 0 }), kill: async () => true })),
    },
    files: {
      write: vi.fn(async () => undefined),
      read: vi.fn(async (path: string) => (path === "/foto.png" ? new Uint8Array([0xff, 0xfe, 0x00]) : new TextEncoder().encode("ñandú"))),
      remove: vi.fn(async () => undefined),
      list: vi.fn(async () => [{ name: "1.json" }]),
    },
    pause: vi.fn(async () => true),
    kill: vi.fn(async () => true),
    setTimeout: vi.fn(async () => undefined),
    updateNetwork: vi.fn(async () => undefined),
  };
  const sdk: E2bSdkLike = {
    Sandbox: {
      create: vi.fn(async () => box),
      connect: vi.fn(async () => box),
      kill: vi.fn(async () => true),
    },
  };
  return { sdk, box };
}

const config = { apiKey: "k", template: "openlen-terminal-v1", dailyUsd: 5, onlyUsers: null };

describe("e2bDriver", () => {
  it("the network's allow list: package registries, GitHub and the CDNs pages use", () => {
    // E2B doesn't cap allowOut (docs.e2b.dev, 21/10); the cap of 10 is for header rules.
    for (const h of ["registry.npmjs.org", "pypi.org", "github.com", "esm.sh", ...PAGE_CDNS]) expect(BOX_ALLOW_OUT).toContain(h);
  });

  it("with the project's network: its hosts allowed, each with the marker header rule", async () => {
    const { sdk } = fakeSdk();
    const network = { hosts: ["lienzo-x.openlen.app", "abc.openlen.app"], headers: { "x-openlen-caja": "p.mac" } };
    await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {}, network });
    const opts = (sdk.Sandbox.create as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.network.allowOut).toEqual([...BOX_ALLOW_OUT, "lienzo-x.openlen.app", "abc.openlen.app"]);
    expect(opts.network.rules).toEqual({
      "lienzo-x.openlen.app": [{ transform: { headers: { "x-openlen-caja": "p.mac" } } }],
      "abc.openlen.app": [{ transform: { headers: { "x-openlen-caja": "p.mac" } } }],
    });
  });

  it("the connected Shopify store is allowed out, with no header rule", async () => {
    const { sdk } = fakeSdk();
    const network = { hosts: ["abc.openlen.app"], headers: { "x-openlen-caja": "p.mac" }, thirdPartyHosts: ["x.myshopify.com", "www.tienda.mx"] };
    await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {}, network });
    const opts = (sdk.Sandbox.create as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.network.allowOut).toEqual([...BOX_ALLOW_OUT, "abc.openlen.app", "x.myshopify.com", "www.tienda.mx"]);
    expect(Object.keys(opts.network.rules)).toEqual(["abc.openlen.app"]);
  });

  it("only the store, with no OpenLen host: allowed, and no rules at all", async () => {
    const { sdk } = fakeSdk();
    await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {}, network: { hosts: [], headers: {}, thirdPartyHosts: ["x.myshopify.com"] } });
    const opts = (sdk.Sandbox.create as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.network.allowOut).toEqual([...BOX_ALLOW_OUT, "x.myshopify.com"]);
    expect(opts.network.rules).toBeUndefined();
  });

  it("resuming sets the network again (a backend or a publish may be new); without one, it is left as it was", async () => {
    const { sdk, box: raw } = fakeSdk();
    const network = { hosts: ["abc.openlen.app"], headers: { "x-openlen-caja": "p.mac" } };
    await e2bDriver(config, async () => sdk).resume("sbx-1", network);
    expect(raw.updateNetwork).toHaveBeenCalledWith({
      denyOut: ["0.0.0.0/0"],
      allowOut: [...BOX_ALLOW_OUT, "abc.openlen.app"],
      rules: { "abc.openlen.app": [{ transform: { headers: { "x-openlen-caja": "p.mac" } } }] },
    });
    (raw.updateNetwork as ReturnType<typeof vi.fn>).mockClear();
    await e2bDriver(config, async () => sdk).resume("sbx-1");
    expect(raw.updateNetwork).not.toHaveBeenCalled();
  });

  it("creates the box closed: everything out denied but the allow list, nothing in, no secrets", async () => {
    const { sdk } = fakeSdk();
    await e2bDriver(config, async () => sdk).create({ template: "openlen-terminal-v1", metadata: { projectId: "p" } });
    const [template, opts] = (sdk.Sandbox.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(template).toBe("openlen-terminal-v1");
    expect(opts).toMatchObject({
      apiKey: "k",
      metadata: { projectId: "p" },
      network: { denyOut: ["0.0.0.0/0"], allowOut: BOX_ALLOW_OUT, allowPublicTraffic: false },
      lifecycle: { onTimeout: "pause", autoResume: false },
    });
    expect(opts.envs).toBeUndefined();
  });

  it("a long turn keeps its box: a command 5 minutes after the last extension gives E2B's timeout back in full", async () => {
    const { sdk, box: raw } = fakeSdk();
    let now = 1_000_000;
    const box = await e2bDriver(config, async () => sdk, () => now).create({ template: "t", metadata: {} });
    await box.run("a", { timeoutMs: 5_000 });
    now += 4 * 60_000;
    await box.run("b", { timeoutMs: 5_000 });
    expect(raw.setTimeout).not.toHaveBeenCalled();
    now += 2 * 60_000;
    await box.run("c", { timeoutMs: 5_000 });
    expect(raw.setTimeout).toHaveBeenCalledTimes(1);
    expect(raw.setTimeout).toHaveBeenCalledWith(15 * 60_000);
  });

  it("a failed extension doesn't fail the command", async () => {
    const { sdk, box: raw } = fakeSdk();
    (raw.setTimeout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("E2B busy"));
    let now = 0;
    const box = await e2bDriver(config, async () => sdk, () => now).create({ template: "t", metadata: {} });
    now += 10 * 60_000;
    expect((await box.run("echo hola", { timeoutMs: 5_000 })).stdout).toBe("hola\n");
  });

  it("runs a command and gives back its output and exit code", async () => {
    const { sdk } = fakeSdk();
    const box = await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {} });
    expect(await box.run("echo hola", { timeoutMs: 5_000 })).toEqual({ stdout: "hola\n", stderr: "", exitCode: 0, timedOut: false, pid: 7 });
  });

  it("a command that exits non-zero is an answer, not an exception", async () => {
    const { sdk, box: raw } = fakeSdk();
    (raw.commands.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      pid: 8,
      wait: async () => {
        throw Object.assign(new Error("exit 2"), { exitCode: 2, stdout: "", stderr: "no\n" });
      },
      kill: async () => true,
    });
    const box = await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {} });
    expect(await box.run("grep x /nada", { timeoutMs: 5_000 })).toMatchObject({ exitCode: 2, stderr: "no\n", timedOut: false });
  });

  it("a command over its time comes back timed out and keeps running", async () => {
    const { sdk, box: raw } = fakeSdk();
    const kill = vi.fn(async () => true);
    (raw.commands.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ pid: 9, wait: () => new Promise(() => {}), kill });
    const box = await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {} });
    expect(await box.run("sleep 100", { timeoutMs: 20 })).toMatchObject({ timedOut: true, pid: 9 });
    expect(kill).not.toHaveBeenCalled();
  });

  it("reads text as text and anything that is not UTF-8 as binary", async () => {
    const { sdk } = fakeSdk();
    const box = await e2bDriver(config, async () => sdk).create({ template: "t", metadata: {} });
    expect(await box.read(["/a.txt", "/foto.png"])).toEqual({ "/a.txt": { text: "ñandú" }, "/foto.png": { binary: true, size: 3 } });
  });

  it("writes many files in one call, resumes by id and pauses", async () => {
    const { sdk, box: raw } = fakeSdk();
    const d = e2bDriver(config, async () => sdk);
    const box = await d.resume("sbx-1");
    await box.write({ "/a": "1", "/b": "2" });
    expect(raw.files.write).toHaveBeenCalledWith([{ path: "/a", data: "1" }, { path: "/b", data: "2" }]);
    await box.pause();
    expect(raw.pause).toHaveBeenCalled();
    expect(sdk.Sandbox.connect).toHaveBeenCalledWith("sbx-1", expect.objectContaining({ apiKey: "k" }));
  });
});
