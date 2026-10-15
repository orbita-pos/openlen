// Our git over a memory store, with the same author and clock as RealRepo.
import type { GitRunResult } from "../command";
import { memoryStore } from "../memory-store";
import { runGit } from "../run";
import { AUTHOR, START } from "./real-git";

export class OurRepo {
  readonly store = memoryStore();
  /** Absolute paths, as the terminal sends them. */
  files: Record<string, string> = {};
  timestamp = START;

  /** Repository paths ("src/App.tsx"); `null` deletes the file. */
  write(files: Readonly<Record<string, string | null>>): void {
    for (const [p, content] of Object.entries(files)) {
      if (content === null) delete this.files[`/${p}`];
      else this.files[`/${p}`] = content;
    }
  }

  async git(args: readonly string[], o: { readonly cwd?: string } = {}): Promise<GitRunResult> {
    const r = await runGit(
      { store: this.store, files: { ...this.files }, cwd: o.cwd ? `/${o.cwd}` : "/", identity: AUTHOR, owner: AUTHOR, now: () => new Date(this.timestamp * 1000) },
      args,
    );
    for (const [p, content] of Object.entries(r.write ?? {})) {
      if (content === null) delete this.files[p];
      else this.files[p] = content;
    }
    return r;
  }
}
