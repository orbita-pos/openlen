// The run a `subagent` launch card names (spec local 2026-11-01-subagentes-de-len, §4.8): the chat's card
// follows it, also after a reload. It travels in the turn's cards, which the client saves back, so it is
// cleaned like any other field there. Pure and client-safe.

export interface SubagentRef {
  readonly id: string;
  readonly preset: string;
}

const ID = /^[\w-]{1,64}$/;
const PRESET = /^[\w-]{1,32}$/;

export function subagentRefFrom(v: unknown): SubagentRef | null {
  if (!v || typeof v !== "object") return null;
  const { id, preset } = v as { id?: unknown; preset?: unknown };
  return typeof id === "string" && ID.test(id) && typeof preset === "string" && PRESET.test(preset) ? { id, preset } : null;
}
