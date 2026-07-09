import { describe, it, expect } from "vitest";
import { summaryLabel } from "./agent-action-card";
import type { AgentAction } from "./agent-action-card";

// F4-T8 hardening: summaryLabel is the seam where the agent's action-card
// summary either gets localized (for the three tools that send a stable
// CODE) or passes through verbatim (everything else — module ids, slugs,
// and model-authored free text). The critical property is the collision
// guard: cambiar_motion legitimately sends the free-text "off" and must NOT
// be localized, while activar_3d/poner_musica's coded "off" MUST be. Assert
// both directions directly.
//
// A trivial mock `t` (key → key) is enough: a localized result comes back as
// the i18n KEY (never the raw code), a passthrough comes back as the input
// verbatim — so "is it the key vs the raw value" fully distinguishes the two
// branches without loading next-intl.
const t = ((key: string) => key) as unknown as Parameters<typeof summaryLabel>[1];

function action(tool: string, summary: string): AgentAction {
  return { tool, status: "done", summary };
}

describe("summaryLabel (F4-T8 i18n mapping)", () => {
  it("(a) activar_3d 'on' → localized, NOT the raw code", () => {
    const out = summaryLabel(action("activar_3d", "on"), t);
    expect(out).toBe("agent.action.on");
    expect(out).not.toBe("on");
  });

  it("(a') poner_musica 'off' → localized, NOT the raw code", () => {
    const out = summaryLabel(action("poner_musica", "off"), t);
    expect(out).toBe("agent.action.off");
    expect(out).not.toBe("off");
  });

  it("(b) COLLISION GUARD: cambiar_motion 'off' is free text — passthrough, NOT localized", () => {
    // cambiar_motion is NOT in SUMMARY_CODE_TOOLS: its "off" is a real
    // Motion-Look value (MOTION_LOOKS includes "off"), user-neutral, and must
    // reach the card verbatim — localizing it would mistranslate a look name.
    expect(summaryLabel(action("cambiar_motion", "off"), t)).toBe("off");
  });

  it("(c) editar_pagina free-text summary is rendered verbatim", () => {
    expect(summaryLabel(action("editar_pagina", "titular menú"), t)).toBe("titular menú");
  });

  it("(d) trabajar_en_pagina '' home sentinel → localized home label", () => {
    const out = summaryLabel(action("trabajar_en_pagina", ""), t);
    expect(out).toBe("agent.action.home");
    expect(out).not.toBe("");
  });

  it("(d') trabajar_en_pagina real slug is verbatim, NOT the home label", () => {
    // The "principal"-as-a-real-slug edge case: only the "" sentinel means
    // home; a genuine slug (even one literally named "principal") passes
    // through so it stays distinguishable from a home switch.
    expect(summaryLabel(action("trabajar_en_pagina", "principal"), t)).toBe("principal");
  });
});
