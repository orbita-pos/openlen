import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  verifyReleaseBuildAttestation,
  writeReleaseBuildAttestation,
} from "@/lib/generation/release-build-attestation";

const execFileAsync = promisify(execFile);

async function currentRevision(workspaceRoot: string): Promise<string> {
  const result = await execFileAsync("git", ["-c", `safe.directory=${workspaceRoot.replaceAll("\\", "/")}`, "rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    windowsHide: true,
    maxBuffer: 8 * 1024,
  });
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const revision = await currentRevision(workspaceRoot);
  const approvedRevision = process.env.OPENLEN_FABLE_PARITY_APPROVED_REVISION?.trim();
  if (!approvedRevision || approvedRevision !== revision) throw new Error("approved revision does not match current release revision");
  const mode = process.argv[2];
  const attestation = mode === "--write"
    ? await writeReleaseBuildAttestation(workspaceRoot, revision)
    : mode === "--verify"
      ? await verifyReleaseBuildAttestation(workspaceRoot, revision)
      : undefined;
  if (!attestation) throw new Error("expected --write or --verify");
  console.log(JSON.stringify({
    event: mode === "--write" ? "release_build_attestation_written" : "release_build_attestation_verified",
    sourceRevision: attestation.sourceRevision,
    buildId: attestation.buildId,
    artifactDigest: attestation.artifactDigest,
    attestationSha256: attestation.attestationSha256,
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Release build attestation failed (details redacted).");
    process.exitCode = 1;
  });
}
