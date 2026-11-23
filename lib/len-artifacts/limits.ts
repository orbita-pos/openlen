// THE CAPS OF AN AGENT'S TOOLS (spec local 2026-11-22-artifacts-de-len, §1 and §3). For every plan: what a
// tool costs is the agent's turn that writes it, in credits — these only keep one agent's tools, and the small database
// they share with it, from growing without end.

/** Tools one agent can have (published ones; a republish of the same folder is not a new tool). */
export const LEN_ARTIFACTS_PER_MAKER = 5;

/** The size of one published version: every file of its folder, added up. */
export const LEN_ARTIFACT_VERSION_MAX_BYTES = 10 * 1024 * 1024;

/** Documents in one tool's database. */
export const LEN_ARTIFACT_DOCS_MAX = 1000;

/** One document: the UTF-8 length of its JSON. */
export const LEN_ARTIFACT_DOC_MAX_BYTES = 64 * 1024;

/** One tool's database: the sum of its documents' sizes. */
export const LEN_ARTIFACT_DATA_MAX_BYTES = 5 * 1024 * 1024;

/** The most documents one `query` returns — also what no `limit` means, so no answer is ever a whole collection. */
export const LEN_ARTIFACT_QUERY_LIMIT_MAX = 100;

/** The most writes in one `artifact_data` batch: a batch is one transaction, and past this a model is seeding, not editing. */
export const LEN_ARTIFACT_BATCH_MAX = 100;

/** The most one `artifact_data` answer carries of rows (their JSON): 100 documents of 64 KB would be 6 MB of context kept in the
 *  conversation for good. A document is never cut: the answer holds the first ones that fit, and says so. */
export const LEN_ARTIFACT_ANSWER_MAX_BYTES = 100 * 1024;

// The two screens' routes (app/api/len-artifacts/[id]/data and /follow) read these from here: a route file may export only
// its handlers and Next's settings, or `next build` fails (lib/route-exports.test.ts).

/** The most a call's body may weigh: one document is at most 64 KB, so four times that leaves room for its JSON's escapes
 *  and a query — and a page can't make the server parse megabytes before the store's own check refuses them. */
export const DATA_BODY_MAX_BYTES = 256 * 1024;

/** The most a screen may leave unread before its stream is closed: more than two whole baselines of a full tool (5 MB of
 *  data each). A screen that stopped reading would otherwise keep every change in this process's memory; closed, it
 *  reconnects when it can and gets one fresh baseline — a slow follower is dropped, never waited for (DeepSeek's follow). */
export const FOLLOW_UNREAD_MAX_BYTES = 16 * 1024 * 1024;
