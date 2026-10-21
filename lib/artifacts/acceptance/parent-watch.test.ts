// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parentIsAlive } from "./parent-watch";

// 21/10: a worker launched in the background outlived the session that started it (Windows does not end a dead
// process's children). A run that can spend money must notice that whoever launched it is gone.
it("says the parent is gone once the process that launched it has ended", async () => {
  expect(parentIsAlive(process.pid)).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), "parent-watch-"));
  try {
    const marker = join(dir, "child.txt");
    // The middle process starts a grandchild that polls its own parent, prints the parent's pid, and exits.
    const grandchild = `const {parentIsAlive}=require(${JSON.stringify(join(__dirname, "parent-watch.ts"))});const fs=require("node:fs");const ppid=process.ppid;fs.writeFileSync(${JSON.stringify(marker)},"started "+ppid);const t=setInterval(()=>{if(!parentIsAlive(ppid)){fs.writeFileSync(${JSON.stringify(marker)},"parent gone");clearInterval(t);}},200);setTimeout(()=>process.exit(0),15000);`;
    const middle = spawn(process.execPath, ["-e", `const c=require("node:child_process").spawn(process.execPath,["--import","tsx","-e",${JSON.stringify(grandchild)}],{stdio:"ignore",detached:true});c.unref();setTimeout(()=>process.exit(0),1500);`], { stdio: "ignore" });
    await new Promise((r) => middle.once("exit", r));
    let text = "";
    for (let i = 0; i < 60 && text !== "parent gone"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      text = await readFile(marker, "utf8").catch(() => "");
    }
    expect(text).toBe("parent gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
