// lib/ai/chromium-nice.ts — THE BOX IS EVERYONE'S (14/10).
//
// The eyes draw WebGL in software, and SwiftShader runs one thread per core.
// Measured on the production box (3 cores, Chrome 148): a 3D scene took 2.56
// cores for as long as a visit lasted. With Node on the same core, a fixed
// Node job of 5.2 ms took 21 ms (Node kept 27% of the core).
//
// At nice 10 on every Chromium thread the same job took 7.3 ms (76% of the
// core, the worst case: all three SwiftShader threads on Node's core; spread
// one per core as they normally are, ~90%), and the scene drew just as fast
// on its own (5.8 fps against 5.9): it gives the CPU up when someone else
// wants it and loses nothing when nobody does. At nice 19 Node didn't notice
// at all (5.4 ms) but the scene all but stopped (0.3 fps) while Node worked.
//
// Pinning to cores doesn't work: SwiftShader sets its own threads' affinity
// (measured). And on Linux nice is PER THREAD: it is set on every thread there
// is right after launch, and the ones born later inherit it (measured: 92 of
// 92, SwiftShader's included). Without root, Chromium can't lower it again.

import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHROMIUM_NICE = 10;

/** Every pid in the process tree under `root`, read from a /proc-like dir. */
function processTree(procRoot: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(path.join(procRoot, name, "stat"), "utf8");
      // `pid (comm) state ppid …`: the name can hold spaces and parentheses.
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(name)]);
    } catch {
      // Gone between the listing and the read.
    }
  }
  const tree: number[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const pid = pending.pop()!;
    tree.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return tree;
}

/**
 * Gives every thread of a just-launched Chromium a lower priority, so it yields
 * the CPU to the app. Linux only; anywhere else (a dev machine) it does nothing.
 * Never throws. Returns how many threads it reniced.
 */
export function deprioritizeChromium(
  rootPid: number | undefined,
  o: {
    readonly platform?: NodeJS.Platform;
    readonly procRoot?: string;
    readonly setPriority?: (tid: number, priority: number) => void;
  } = {},
): number {
  if ((o.platform ?? process.platform) !== "linux" || !rootPid) return 0;
  const procRoot = o.procRoot ?? "/proc";
  const setPriority = o.setPriority ?? ((tid: number, priority: number) => os.setPriority(tid, priority));
  let reniced = 0;
  try {
    for (const pid of processTree(procRoot, rootPid)) {
      let threads: string[];
      try {
        threads = readdirSync(path.join(procRoot, String(pid), "task"));
      } catch {
        continue;
      }
      for (const tid of threads) {
        try {
          setPriority(Number(tid), CHROMIUM_NICE);
          reniced++;
        } catch {
          // A thread that already ended.
        }
      }
    }
  } catch {
    // No /proc to read: Chromium keeps its priority.
  }
  return reniced;
}
