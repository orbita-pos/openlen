// THE NAMES OF THE CONNECTORS' OWN TOOLS, on their own so a module that only needs a name (the subagent presets, which
// must keep a child away from the tool that leaves a card for the person) doesn't import the turn's whole machinery.
// spec local 2026-11-17-oauth-de-conectores-mcp, §5.5, §6.

/** The tool that offers a curated connector in a Connect card (the name claude.ai uses). */
export const SUGGEST_CONNECTORS_TOOL = "suggest_connectors";
/** The raw name of a server's sign-in tool: declared as `mcp__<server>__authenticate`. */
export const AUTHENTICATE_TOOL = "authenticate";
