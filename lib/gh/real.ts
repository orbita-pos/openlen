// `gh` for a project (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): runGh with the owner's GitHub App
// installations and the project's own git, for both terminals (lib/agent/terminal/git-option.ts).
import "server-only";

import { gitCli } from "@/lib/git/service";
import { installationToken } from "@/lib/integrations/github-app";
import { installationsOf } from "@/lib/integrations/github-app-store";

import { runGh, type GhResult } from "./run";

export async function ghCliFor(p: {
  readonly projectId: string;
  readonly ownerId: string;
  readonly personId: string;
  readonly canEdit: boolean;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly files: Readonly<Record<string, string>>;
}): Promise<GhResult> {
  try {
    return await runGh(p.args, { canEdit: p.canEdit }, {
      installations: () => installationsOf(p.ownerId),
      token: (id, repo) => installationToken(id, repo),
      git: (args) => gitCli({ projectId: p.projectId, ownerId: p.ownerId, personId: p.personId, args, cwd: p.cwd, files: p.files }),
    });
  } catch (err) {
    console.warn("[gh] failed", err);
    return { stdout: "", stderr: "gh: GitHub could not be reached; try again\n", exitCode: 1 };
  }
}
