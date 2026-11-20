// The A/B tool's NAME, apart from its handler (lib/agent/tools-ab.ts): the subagent presets and the assistant only need
// the name, and importing the handler pulls lib/ab → the catalog → subagents/tool.ts while presets.ts is still loading
// (a cycle that left `SUBAGENT_PRESETS` undefined at module init). Same pattern as lib/mcp-connectors/tool-names.ts.
export const CREATE_AB_VARIANT = "create_ab_variant";
