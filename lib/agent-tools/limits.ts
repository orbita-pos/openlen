// THE CAPS OF AN AGENT'S TOOLS (spec local 2026-11-22-herramienta-dentro-del-agente, §1 and §3). For every plan: what a
// tool costs is the agent's turn that writes it, in credits — these only keep one agent's tools, and the small database
// they share with it, from growing without end.

/** Tools one agent can have (published ones; a republish of the same folder is not a new tool). */
export const AGENT_TOOLS_PER_AGENT = 5;

/** The size of one published version: every file of its folder, added up. */
export const AGENT_TOOL_VERSION_MAX_BYTES = 10 * 1024 * 1024;

/** Documents in one tool's database. */
export const AGENT_TOOL_DOCS_MAX = 1000;

/** One document: the UTF-8 length of its JSON. */
export const AGENT_TOOL_DOC_MAX_BYTES = 64 * 1024;

/** One tool's database: the sum of its documents' sizes. */
export const AGENT_TOOL_DATA_MAX_BYTES = 5 * 1024 * 1024;

/** The most documents one `query` returns — also what no `limit` means, so no answer is ever a whole collection. */
export const AGENT_TOOL_QUERY_LIMIT_MAX = 100;
