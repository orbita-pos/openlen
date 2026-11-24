// THE DIRECTORY'S ENTRIES (spec local 2026-11-17-oauth-de-conectores-mcp, §6): the curated list itself, on its own so the
// OAuth client choice (oauth/clients.ts) can read it without importing the flow that imports the client choice. It is
// the ONE source of which servers OpenLen's own OAuth client is for: a (server URL, issuer) pair belongs to OpenLen only
// if an entry here has that exact URL and that exact `issuer`. (The issuer is pinned here, in the data, and not as an
// `oauth.authorizationServer` of the entry the person approves: config.ts, like Claude Code's, accepts that field only
// together with a `clientId`, and a directory entry names none — OpenLen's client is chosen by this pair instead.)
import { GCAL_SCOPES, gcalResourceUrl } from "../google-calendar-mcp/config";

import type { McpOAuthConfig } from "./config";

export interface DirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly what: string;
  readonly server: string;
  readonly issuer: string;
  readonly entry: {
    readonly transport: "streamable-http";
    readonly url: string;
    readonly oauth: McpOAuthConfig;
  };
}

/** Compared exactly: an issuer is an identity, not a URL to tidy. */
export const GOOGLE_ISSUER = "https://accounts.google.com";

export const DIRECTORY: readonly DirectoryEntry[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    what: "Read and add events in the person's Google Calendar",
    server: "google-calendar",
    issuer: GOOGLE_ISSUER,
    // OpenLen's own Calendar server (spec local 2026-11-24-servidor-de-google-calendar, §5.5), as Anthropic hosts
    // gcal.mcp.claude.com: Google's calendarmcp.googleapis.com is a Developer Preview only its testers may call.
    entry: {
      transport: "streamable-http",
      url: gcalResourceUrl(),
      oauth: { scope: GCAL_SCOPES.join(" ") },
    },
  },
];

/** The directory entry that offers `serverUrl` with `issuer` as its authorization server, if any. Both exact strings. */
export function directoryEntryFor(serverUrl: string, issuer: string): DirectoryEntry | undefined {
  return DIRECTORY.find((d) => d.entry.url === serverUrl && d.issuer === issuer);
}
