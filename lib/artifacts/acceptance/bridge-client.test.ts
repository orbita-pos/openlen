// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shellJoin, sshHost, wslHost } from "./bridge-client";

describe("acceptance bridge hosts", () => {
  it("quotes every argument for a remote shell, including quotes, $ and braces", () => {
    expect(shellJoin(["docker", "image", "inspect", "openlen/artifact-renderer:2", "--format", "{{.Id}}"]))
      .toBe("'docker' 'image' 'inspect' 'openlen/artifact-renderer:2' '--format' '{{.Id}}'");
    expect(shellJoin(["sh", "-c", 'ls -d "${TMPDIR:-/tmp}"/x-* | wc -l'])).toBe(`'sh' '-c' 'ls -d "\${TMPDIR:-/tmp}"/x-* | wc -l'`);
    expect(shellJoin(["echo", "it's"])).toBe("'echo' 'it'\\''s'");
  });

  it("starts a program in WSL with --exec, as before", () => {
    const host = wslHost("Ubuntu-24.04");
    expect(host.command(["node", "/mnt/c/b.mjs"])).toEqual(["wsl.exe", ["-d", "Ubuntu-24.04", "--exec", "node", "/mnt/c/b.mjs"]]);
    expect(host.place("C:\\Users\\j\\b.mjs")).toBe("/mnt/c/Users/j/b.mjs");
    expect(host.label).toBe("Ubuntu-24.04");
  });

  it("starts a program over SSH as the worker's user, with its TMPDIR", () => {
    const host = sshHost("openlen", { runAs: "openlen-artifacts", env: { TMPDIR: "/var/openlen/artifacts-tmp" }, dir: "/opt/openlen-acceptance" });
    expect(host.command(["node", "/opt/openlen-acceptance/b.mjs"])).toEqual([
      "ssh",
      ["-o", "BatchMode=yes", "openlen", "--", "'sudo' '-n' '-u' 'openlen-artifacts' 'env' 'TMPDIR=/var/openlen/artifacts-tmp' 'node' '/opt/openlen-acceptance/b.mjs'"],
    ]);
    expect(host.label).toBe("ssh:openlen (as openlen-artifacts)");
  });

  it("over SSH without a user or env, runs the program as it is", () => {
    expect(sshHost("openlen", { dir: "/opt/x" }).command(["docker", "ps"])).toEqual(["ssh", ["-o", "BatchMode=yes", "openlen", "--", "'docker' 'ps'"]]);
  });

  it("refuses env names a shell would read as something else", () => {
    expect(() => sshHost("openlen", { env: { "A;rm": "x" }, dir: "/opt/x" })).toThrow();
  });
});
