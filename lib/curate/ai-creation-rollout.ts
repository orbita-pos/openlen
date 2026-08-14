import { createHash } from "node:crypto";

const ROLLOUT_SALT = "openlen-ai-creation-rollout/1\0";

export function parseAiCreationRolloutPercent(value: string | undefined): number | null {
  if (!value || !/^(?:[1-9]|[1-9][0-9])$/.test(value)) return null;
  const percent = Number(value);
  return Number.isSafeInteger(percent) && percent >= 1 && percent <= 99 ? percent : null;
}

export function aiCreationRolloutBucket(userId: string): number {
  if (!userId) throw new Error("stable user ID is required");
  return createHash("sha256").update(`${ROLLOUT_SALT}${userId}`, "utf8").digest().readUInt32BE(0) % 100;
}

export function isUserInAiCreationRollout(
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.OPENLEN_AI_CREATION !== "enabled") return false;
  const percent = parseAiCreationRolloutPercent(env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT);
  return percent !== null && aiCreationRolloutBucket(userId) < percent;
}
