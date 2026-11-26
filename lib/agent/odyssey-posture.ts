// lib/agent/odyssey-posture.ts — Architectural creation vs surgical edit posture for Len Odyssey (`mode: "dynamis"`).
//
// Why this lives outside `Len` (`mode: "len"`):
//   - Normal `Len` keeps its exact measured prompt and warm KV cache byte for byte.
//   - In Len Odyssey (Kimi K3.1 Pro), one fixed system-prompt rule separates *Greenfield Creation*
//     (blank/starter projects or explicit full-build requests) from *Live Project Editing* (surgical Edits),
//     so Odyssey never cripples a brand-new 3D world, game or app with "smallest Edit" or greybox-only boxes,
//     AND its system prompt stays constant from Turn 1 to Turn N so Odyssey's own KV cache never breaks.
//   - The dynamic per-turn signal (`ODYSSEY POSTURE:`) travels in `contextBlock` (the non-cached tail message).
//
// Cache effect: constant within `mode === "dynamis"` system prompt; per-turn `odysseyContextPostureLine` sits in `contextBlock` at the end of the conversation; normal `Len` (`mode === "len"`) is untouched byte for byte.

const LEN_SCOPE_BULLET =
  '- What was asked for is the deliverable: don\'t narrow it, don\'t widen it and don\'t quietly turn it into something else. Change ONLY what you were asked, with the smallest Edit that does it; whatever is clearly outside the request —a button, a text, a piece of data, a section nobody mentioned— stays as it is. Finish everything that was asked, not only the easy part, and leave nothing of yours half-built: what you add or change this turn works completely. If one part is blocked, do the rest, leave the blocked part out instead of half-building it —a button that leads nowhere is a broken button— and say what you left out and why. What you come across along the way that nobody asked for —a bug that was already there, a feature that would be handy, something you would do better— you don\'t do. You only touch something outside the request when the request can\'t work without it, and you say so. <example>user: "make the top button green" — agent: changes the color of that button and nothing else; the other buttons, the texts and the page\'s palette stay as they are.</example>';

const ODYSSEY_SCOPE_BULLET =
  '- Match your posture to whether you are CREATING A NEW WORK or EDITING A LIVE PROJECT (see `ODYSSEY POSTURE` in your turn context):\n'
  + '  · **Greenfield creation** (blank or starter-skeleton project, or when the user asks for a brand-new app, game, 3D scene or full redesign): adopt an **Architectural Creation Posture**. Design clean modular file boundaries up front, lock shared interfaces/coordinates first, and build complete, production-grade craft — rich visual hierarchy, real geometry/materials/lighting, responsive controls and polished states — never stopping at minimal stubs or placeholder boxes. For multi-module builds, fan out independent modules in parallel with `subagent` (`agent_preset="len-builder"`, `isolation="worktree"`), batch multi-file reads/checks in `run_code`, and offload heavy browser/screenshot verification to `subagent` (`agent_preset="len-qa"`) so screenshots do not bloat your main context.\n'
  + '  · **Editing a live project** (existing user content, screens or logic): adopt **Surgical Precision**. Change ONLY what was asked with the smallest `Edit` that achieves it; everything outside the request stays untouched. <example>user: "make the top button green" — agent: changes the color of that button and nothing else; the other buttons, texts and palette stay as they are.</example>\n'
  + '  In both postures, finish everything that was asked and leave nothing half-built: if one part is blocked, complete the rest, omit the blocked control rather than leaving a dead button, and state why.';

const PLAIN_BOXES_CLAUSE = "(Kimi's method: first a blockout of plain boxes and a scene that already plays, then the detail)";
const ODYSSEY_GAME_CRAFT_CLAUSE =
  "(lock a metric coordinate blueprint first, wire a playable loop, and build real architectural silhouette, procedural PBR materials, lighting and atmosphere in modular files under /src/game — never leave plain placeholder boxes as the finished scene)";

export function applyOdysseyPosture(prompt: string, opts: { readonly game?: boolean } = {}): string {
  const idx = prompt.indexOf(LEN_SCOPE_BULLET);
  if (idx === -1) {
    throw new Error("odyssey-posture: LEN_SCOPE_BULLET marker not found in system prompt — update lib/agent/odyssey-posture.ts.");
  }
  let out = prompt.slice(0, idx) + ODYSSEY_SCOPE_BULLET + prompt.slice(idx + LEN_SCOPE_BULLET.length);
  if (opts.game) {
    const gameIdx = out.indexOf(PLAIN_BOXES_CLAUSE);
    if (gameIdx === -1) {
      throw new Error("odyssey-posture: PLAIN_BOXES_CLAUSE marker not found in game prompt — update lib/agent/odyssey-posture.ts.");
    }
    out = out.slice(0, gameIdx) + ODYSSEY_GAME_CRAFT_CLAUSE + out.slice(gameIdx + PLAIN_BOXES_CLAUSE.length);
  }
  return out;
}

/** True when a project has no saved edits yet and no prior conversation history in this thread. */
export function isGreenfieldTurn(o: {
  readonly historyLength: number;
  readonly savedChangesCount: number;
  readonly ownerChangesCount?: number;
}): boolean {
  return o.historyLength === 0 && o.savedChangesCount === 0 && (o.ownerChangesCount ?? 0) === 0;
}

export function odysseyContextPostureLine(isGreenfield: boolean): string {
  return isGreenfield
    ? "ODYSSEY POSTURE: GREENFIELD CREATION — fresh project with no prior edits. Architect modular files and build complete, high-craft visuals and mechanics from turn 1 (do not hold back to minimal edits or placeholder boxes).\n\n"
    : "ODYSSEY POSTURE: LIVE PROJECT — existing project state is present. Inspect before changing, preserve everything outside the request, and switch to full architectural build only if the user asks for a new module, screen or redesign.\n\n";
}
