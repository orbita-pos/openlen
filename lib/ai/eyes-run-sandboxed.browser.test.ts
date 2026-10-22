// @vitest-environment node
//
// THE EYES' CHROMIUM RUNS WITH ITS SANDBOX (2026-10-20).
//
// `lanzarChromium` used to pass `--no-sandbox`, so the renderer that runs the
// model's pages had no seccomp and shared the server's namespaces. Measured on
// the production box the same day (systemd-run as openlen-deploy with the
// unit's hardening): without `--no-sandbox` Chrome starts, Ubuntu's AppArmor
// `chrome` profile attaches under NoNewPrivileges, every renderer runs with
// seccomp-bpf in its own user and PID namespace, and WebGL still renders.
// `--disable-setuid-sandbox` stays: under NoNewPrivileges the setuid helper
// can never work, and Chrome must not fall back to it.
import { readFileSync, readdirSync } from "node:fs";
import puppeteer from "puppeteer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lanzarChromium } from "./visual-quality-renderer";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seccomp mode of every renderer in the process tree under `rootPid` (Linux /proc). 2 = filtered. */
function rendererSeccompModes(rootPid: number): number[] {
  const children = new Map<number, number[]>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      // `pid (comm) state ppid …`: the name can hold spaces and parentheses.
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(name)]);
    } catch {
      // Gone between the listing and the read.
    }
  }
  const modes: number[] = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    queue.push(...(children.get(pid) ?? []));
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--type=renderer")) continue;
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      modes.push(Number(/^Seccomp:\s*(\d+)/m.exec(status)?.[1] ?? -1));
    } catch {
      // Gone between the listing and the read.
    }
  }
  return modes;
}

describe("the eyes' Chromium", () => {
  it("🔴 runs with Chrome's sandbox: no --no-sandbox, and no setuid fallback", async () => {
    const launch = vi.spyOn(puppeteer, "launch");
    const browser = await lanzarChromium();
    try {
      const args = launch.mock.calls[0]?.[0]?.args ?? [];
      expect(args).not.toContain("--no-sandbox");
      expect(args).toContain("--disable-setuid-sandbox");

      // And it still starts and draws with the sandbox on.
      const page = await browser.newPage();
      await page.setContent("<p id=ok>ok</p>");
      expect(await page.$eval("#ok", (el) => el.textContent)).toBe("ok");

      // Where the OS lets us look: the renderer really is filtered.
      const pid = browser.process()?.pid;
      if (process.platform === "linux" && pid) {
        const modes = rendererSeccompModes(pid);
        expect(modes.length).toBeGreaterThan(0);
        expect(modes.every((m) => m === 2), `renderer seccomp modes: ${modes.join(",")}`).toBe(true);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
