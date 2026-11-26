// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { buildAgentMessages } from "./context";
import { NO_AGENT_TYPES } from "./subagents/agent-registry";
import { childTypeOf, omitsBasePromptFor } from "./subagents/presets";
import { childMessages } from "./subagents/run";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };

describe("Len Odyssey Paso 3: clean specialist subagents and creation vs live-edit posture", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves normal Len's system prompt, subagent declaration and context byte-for-byte untouched", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    const lenSys = buildAgentSystemPrompt(process.env, "len");
    const defaultSys = buildAgentSystemPrompt(process.env);
    expect(lenSys).toBe(defaultSys);
    expect(lenSys).not.toContain("Architectural Creation Posture");

    const lenSub = buildFunctionDeclarations(process.env, {}, "len").find((d) => d.name === "subagent")!;
    expect(String(lenSub.description)).not.toContain("len-builder");
    expect(String(lenSub.description)).not.toContain("len-qa");

    const odysseySub = buildFunctionDeclarations(process.env, {}, "dynamis").find((d) => d.name === "subagent")!;
    expect(String(odysseySub.description)).toContain("len-builder");
    expect(String(odysseySub.description)).toContain("len-qa");
  });

  it("gives len-builder and len-qa a compact technical prompt without /AGENTS.md or LEN.md bloat", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    const baseTurnArgs = {
      state: { ficheros: ["/src/App.tsx"] },
      mode: "dynamis" as const,
      app: APP,
      game: true,
      prompt: "Build a haunted mansion 3D game",
      history: [],
      memoryMessage: "PROJECT LEN.MD CONTENT",
      userMemory: "PERSONAL NOTES CONTENT",
      maxPromptTokens: 120_000,
    };

    const builderType = childTypeOf("len-builder", NO_AGENT_TYPES)!;
    const qaType = childTypeOf("len-qa", NO_AGENT_TYPES)!;
    const designType = childTypeOf("len-design", NO_AGENT_TYPES)!;

    expect(omitsBasePromptFor(builderType)).toBe(true);
    expect(omitsBasePromptFor(qaType)).toBe(true);
    expect(omitsBasePromptFor(designType)).toBe(false);

    const builderMsgs = childMessages(baseTurnArgs, builderType, "Implement /src/game/lighting.ts");
    const designMsgs = childMessages(baseTurnArgs, designType, "Redesign the HUD");

    // Clean specialist has no /AGENTS.md attachment, no LEN.md memory, and a ~5x smaller prompt head.
    const builderAll = JSON.stringify(builderMsgs);
    expect(builderMsgs[0]!.content).toContain("PROJECT SURFACE — BROWSER GAME APP");
    expect(builderMsgs[0]!.content).toContain("SUBAGENT — LEN-BUILDER:");
    expect(builderMsgs[0]!.content).not.toContain("MODULES YOU CAN OPERATE (toggle_module)");
    expect(builderAll).not.toContain("PROJECT LEN.MD CONTENT");
    expect(builderAll).not.toContain("PERSONAL NOTES CONTENT");
    expect(builderAll.length).toBeLessThan(JSON.stringify(designMsgs).length / 3);

    const qaMsgs = childMessages(baseTurnArgs, qaType, "Verify desktop & mobile WebGL scene");
    expect(qaMsgs[0]!.content).toContain("SUBAGENT — LEN-QA:");
    expect(qaMsgs[0]!.content).toContain("screenshots inside your own QA session");
  });

  it("keeps Odyssey's systemPrompt constant across turns (preserving KV cache) while switching ODYSSEY POSTURE in contextBlock", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    const turn1 = buildAgentMessages({
      state: { ficheros: ["/index.html"] },
      mode: "dynamis",
      app: APP,
      game: true,
      prompt: "Make a 3D horror mansion",
      history: [],
      cambios: [],
      maxPromptTokens: 120_000,
    });
    const turn2 = buildAgentMessages({
      state: { ficheros: ["/index.html", "/src/game/world.ts"] },
      mode: "dynamis",
      app: APP,
      game: true,
      prompt: "Make the flashlight dimmer",
      history: [
        { role: "user", content: "Make a 3D horror mansion" },
        { role: "assistant", content: "Built the mansion." },
      ],
      cambios: [{ label: "Built mansion", page: null, createdAt: new Date(0) }],
      maxPromptTokens: 120_000,
    });
    if (!turn1.ok || !turn2.ok) throw new Error("expected ok");

    // Fixed system prompt across Turn 1 and Turn 2 -> 100% KV prefix preservation!
    expect(turn1.systemPrompt).toBe(turn2.systemPrompt);
    expect(turn1.systemPrompt).not.toContain("first a blockout of plain boxes");
    expect(turn1.systemPrompt).toContain("never leave plain placeholder boxes as the finished scene");

    // Dynamic per-turn posture signal in contextBlock!
    expect(turn1.contextBlock).toContain("ODYSSEY POSTURE: GREENFIELD CREATION");
    expect(turn2.contextBlock).toContain("ODYSSEY POSTURE: LIVE PROJECT");

    // Normal Len never gets ODYSSEY POSTURE in contextBlock.
    const lenTurn = buildAgentMessages({
      state: { ficheros: ["/index.html"] },
      mode: "len",
      prompt: "Hola",
      history: [],
      maxPromptTokens: 120_000,
    });
    if (!lenTurn.ok) throw new Error("expected ok");
    expect(lenTurn.contextBlock).not.toContain("ODYSSEY POSTURE:");
  });
});
