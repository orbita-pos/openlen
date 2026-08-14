import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";

type Environment = Readonly<Record<string, string | undefined>>;
type RuntimeMode = "enabled" | "disabled";

export interface FableParityRuntimeModeDeps {
  readonly applyTargetMode: (targetMode: RuntimeMode) => Promise<void>;
  readonly readEffectiveMode: () => Promise<RuntimeMode>;
  readonly applyTargetRolloutPercent: (percent: number) => Promise<void>;
  readonly readEffectiveRolloutPercent: () => Promise<number>;
  readonly explicitCloneReachable: () => Promise<boolean>;
}

export async function runFableParityRollbackCli(deps: FableParityRuntimeModeDeps) {
  await deps.applyTargetMode("disabled");
  await deps.applyTargetRolloutPercent(0);
  const effectiveMode = await deps.readEffectiveMode();
  if (effectiveMode !== "disabled") throw new Error("rollback did not make disabled effective in the configured runtime");
  const effectiveRolloutPercent = await deps.readEffectiveRolloutPercent();
  if (effectiveRolloutPercent !== 0) throw new Error("rollback did not make zero rollout effective in the configured runtime");
  if (!(await deps.explicitCloneReachable())) throw new Error("explicit template clone route is not reachable after rollback");
  const effective = {
    aiCreation: effectiveMode,
    rolloutPercent: effectiveRolloutPercent,
    wholeTemplateFallback: false as const,
    explicitTemplateClone: true as const,
  };
  const unsigned = {
    schemaVersion: "fable-parity-rollback/2.0" as const,
    verified: true as const,
    effective,
    providerCalls: 0 as const,
  };
  return { ...unsigned, evidenceSha256: canonicalJsonSha256(unsigned) };
}

const execFileAsync = promisify(execFile);

function sshConfiguration(env: Environment): { host: string; remoteDir: string } {
  const host = env.OPENLEN_HOST?.trim() || "openlen";
  const remoteDir = env.OPENLEN_REMOTE_PATH?.trim() || "/opt/openlen-app";
  if (!/^[A-Za-z0-9._-]+$/.test(host)) throw new Error("invalid rollback SSH host alias");
  if (!/^\/[A-Za-z0-9._/-]+$/.test(remoteDir) || remoteDir.split("/").includes("..")) throw new Error("invalid rollback remote application path");
  return { host, remoteDir };
}

async function ssh(host: string, command: string): Promise<string> {
  const result = await execFileAsync("ssh", [host, command], { windowsHide: true, maxBuffer: 64 * 1024 });
  return result.stdout.trim();
}

type SshRunner = (host: string, command: string) => Promise<string>;

export function createFableParityProductionRuntimeDeps(
  env: Environment,
  runSsh: SshRunner = ssh,
): FableParityRuntimeModeDeps {
  const { host, remoteDir } = sshConfiguration(env);
  const applyDisabled = [
    "set -eu",
    "test -f /etc/openlen/openlen.env",
    "tmp_env=$(mktemp /etc/openlen/openlen.env.openlen-ai.XXXXXX)",
    "trap 'rm -f \"$tmp_env\"' EXIT",
    "awk 'BEGIN{seen_mode=0;seen_percent=0} /^OPENLEN_AI_CREATION=/{if(!seen_mode){print \"OPENLEN_AI_CREATION=disabled\";seen_mode=1};next} /^OPENLEN_AI_CREATION_ROLLOUT_PERCENT=/{if(!seen_percent){print \"OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0\";seen_percent=1};next} {print} END{if(!seen_mode)print \"OPENLEN_AI_CREATION=disabled\";if(!seen_percent)print \"OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0\"}' /etc/openlen/openlen.env > \"$tmp_env\"",
    "chown --reference=/etc/openlen/openlen.env \"$tmp_env\"",
    "chmod --reference=/etc/openlen/openlen.env \"$tmp_env\"",
    "mv -f \"$tmp_env\" /etc/openlen/openlen.env",
    "trap - EXIT",
    "systemctl restart openlen-app",
    "systemctl is-active --quiet openlen-app",
    "pid=$(systemctl show -p MainPID --value openlen-app)",
    "test \"$pid\" -gt 0",
    "tr '\\000' '\\n' < \"/proc/$pid/environ\" | grep -Fx 'OPENLEN_AI_CREATION=disabled' > /dev/null",
    "tr '\\000' '\\n' < \"/proc/$pid/environ\" | grep -Fx 'OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0' > /dev/null",
  ].join("\n");
  const readEffective = [
    "set -eu",
    "pid=$(systemctl show -p MainPID --value openlen-app)",
    "test \"$pid\" -gt 0",
    "tr '\\000' '\\n' < \"/proc/$pid/environ\" | grep -Fx 'OPENLEN_AI_CREATION=disabled' > /dev/null",
    "tr '\\000' '\\n' < \"/proc/$pid/environ\" | grep -Fx 'OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0' > /dev/null",
    "mode=$(tr '\\000' '\\n' < \"/proc/$pid/environ\" | sed -n 's/^OPENLEN_AI_CREATION=//p' | tail -n 1)",
    "percent=$(tr '\\000' '\\n' < \"/proc/$pid/environ\" | sed -n 's/^OPENLEN_AI_CREATION_ROLLOUT_PERCENT=//p' | tail -n 1)",
    "test \"$mode\" = disabled",
    "test \"$percent\" = 0",
    "printf '%s\\n%s' \"$mode\" \"$percent\"",
  ].join("\n");
  let targetModePrepared = false;
  let effectiveReadback: { mode: RuntimeMode; rolloutPercent: number } | undefined;
  const loadEffectiveReadback = async () => {
    if (effectiveReadback) return effectiveReadback;
    const [mode, percent, ...extra] = (await runSsh(host, readEffective)).split(/\r?\n/);
    if (extra.length > 0 || (mode !== "enabled" && mode !== "disabled") || percent !== "0") {
      throw new Error("configured runtime did not expose disabled mode with zero rollout");
    }
    effectiveReadback = { mode, rolloutPercent: 0 };
    return effectiveReadback;
  };
  return {
    applyTargetMode: async (targetMode) => {
      if (targetMode !== "disabled") throw new Error("rollback only permits the disabled target mode");
      targetModePrepared = true;
    },
    applyTargetRolloutPercent: async (percent) => {
      if (!targetModePrepared || percent !== 0) throw new Error("rollback only permits disabled mode with zero rollout");
      await runSsh(host, applyDisabled);
      effectiveReadback = undefined;
    },
    readEffectiveMode: async () => {
      return (await loadEffectiveReadback()).mode;
    },
    readEffectiveRolloutPercent: async () => (await loadEffectiveReadback()).rolloutPercent,
    explicitCloneReachable: async () => (
      await runSsh(host, [
        "set -eu",
        "systemctl is-active --quiet openlen-app",
        `test -f '${remoteDir}/.next/server/app/api/projects/from-template/route.js'`,
        "status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{\"templateId\":\"openlen-rollback-probe\"}' http://127.0.0.1:3000/api/projects/from-template)",
        "case \"$status\" in 401|403) printf reachable ;; *) exit 1 ;; esac",
      ].join("\n"))
    ) === "reachable",
  };
}

async function main(): Promise<void> {
  const evidence = await runFableParityRollbackCli(createFableParityProductionRuntimeDeps(process.env));
  const path = join(process.cwd(), "scratch", "fable-parity", "rollback-evidence.json");
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, evidence);
  console.log(JSON.stringify({ event: "fable_parity_rollback", ...evidence }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Fable parity rollback verification failed.");
    process.exitCode = 1;
  });
}
