// WHAT NEVER LEAVES THE BOX (spec local 2026-11-24-servidor-de-google-calendar, §5.8): the replay scenes and the bench's
// customer cases are production conversations that people read, and Google's Limited Use forbids people reading what a
// person's Google account gave Len. So a conversation where Len called a connector is never fetched — asked on the box in
// SQL first (`connectorCallsIn`), then checked again on the rows (`carriesConnectorResults`). What counts as a connector's
// results is decided in one place, lib/mcp-connectors/connector-results.ts.
export { carriesConnectorResults, connectorCallsIn } from "../mcp-connectors/connector-results";

/** The line a fetcher prints (or throws) for what it left on the box. */
export const LEFT_FOR_LIMITED_USE = "carries a connector's results: not fetched (Google Limited Use)";
