import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fakeDriver } from "./fake-driver";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("fakeDriver", () => {
  it("write and read give back what was written; a file that is not UTF-8 reads as binary", async () => {
    const d = fakeDriver();
    const box = await d.create({ template: "t", metadata: { projectId: "p" } });
    await box.write({ "/index.html": "<h1>hola</h1>" });
    d.files(box.id).set("/foto.png", "�\u0000PNG");
    d.binary(box.id, "/foto.png", 1234);
    expect(await box.read(["/index.html", "/foto.png", "/no.txt"])).toEqual({
      "/index.html": { text: "<h1>hola</h1>" },
      "/foto.png": { binary: true, size: 1234 },
    });
  });

  it("runs commands through onRun, which can change the files", async () => {
    const d = fakeDriver({
      onRun: (cmd, files) => {
        if (cmd.includes("echo hola > /nota.txt")) files.set("/nota.txt", "hola\n");
        return { stdout: "ok\n", exitCode: 0 };
      },
    });
    const box = await d.create({ template: "t", metadata: {} });
    expect(await box.run("cd / && echo hola > /nota.txt", { timeoutMs: 1000 })).toMatchObject({ stdout: "ok\n", exitCode: 0, timedOut: false });
    expect(d.files(box.id).get("/nota.txt")).toBe("hola\n");
  });

  it("answers openlen-manifest with the hashes of the project's files only", async () => {
    const d = fakeDriver();
    const box = await d.create({ template: "t", metadata: {} });
    await box.write({ "/index.html": "a", "/tmp/x": "b", "/home/user/.len/LEN.md": "c", "/usr/bin/z": "d" });
    const r = await box.run("openlen-manifest", { timeoutMs: 1000 });
    expect(JSON.parse(r.stdout)).toEqual({ "/index.html": sha("a"), "/home/user/.len/LEN.md": sha("c") });
  });

  it("pause, resume and kill", async () => {
    const d = fakeDriver();
    const box = await d.create({ template: "t", metadata: {} });
    await box.write({ "/a": "1" });
    await box.pause();
    expect(d.paused(box.id)).toBe(true);
    const again = await d.resume(box.id);
    expect(d.paused(box.id)).toBe(false);
    expect(await again.read(["/a"])).toEqual({ "/a": { text: "1" } });
    await d.kill(box.id);
    await expect(d.resume(box.id)).rejects.toThrow(/not found/);
  });

  it("lists a folder's names and removes files", async () => {
    const d = fakeDriver();
    const box = await d.create({ template: "t", metadata: {} });
    await box.write({ "/run/openlen/requests/1.json": "{}", "/run/openlen/requests/2.json": "{}", "/a": "1" });
    expect((await box.list("/run/openlen/requests")).sort()).toEqual(["1.json", "2.json"]);
    await box.remove(["/a", "/run/openlen/requests/1.json"]);
    expect(await box.list("/run/openlen/requests")).toEqual(["2.json"]);
    expect(await box.read(["/a"])).toEqual({});
  });
});
