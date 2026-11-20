// THE NAME THE CALLBACK PAGE AND THE WORKSPACE USE TO MEET (spec local 2026-11-17-oauth-de-conectores-mcp, §10.5): the
// `type` of the message the way back posts, and the name of the same-origin `BroadcastChannel` it posts it on. Client-safe:
// no imports (the callback route and the sign-in popup both read it).

export const SIGN_IN_CHANNEL = "openlen:mcp-oauth";
