// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): what OpenLen — never the model — shows the person
// before a server Len added or changed connects. DeepSeek asks approval for every change to the profile's plugins; here
// the tap approves one entry's fingerprint. A credential is a name of the person any entry may cite, as in DeepSeek, so
// the card names each key the server would receive and, in red, any other host that already gets it.
import { entryFingerprint, parseMcpConfig, type McpConfig, type McpServerEntry } from "./config";
import { oauthEnabled } from "./oauth/enabled";
import type { ServerState, StoredConfig } from "./store";
import { credentialRefs, credentialRefsOf } from "./templates";

export interface ApproveDeps {
  read(personId: string): Promise<StoredConfig>;
  approve(personId: string, name: string, fingerprint: string, expectedVersion: number): Promise<boolean>;
  setCredential(personId: string, name: string, value: string): Promise<void>;
  mount(personId: string, name: string): Promise<ServerState | null>;
}

/** The person's tap: approve the entry exactly as the card showed it, store the keys typed in the card (only ones the
 *  entry cites), then mount it. Anything that moved in between refuses the whole tap. */
export async function approveServer(
  personId: string,
  name: string,
  fingerprint: string,
  version: number,
  credentials: Readonly<Record<string, string>>,
  d: ApproveDeps,
): Promise<{ ok: true; state: ServerState | null } | { ok: false; reason: "changed" | "unknown_credential" }> {
  const stored = await d.read(personId);
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  const entry = parsed.ok ? parsed.config.servers[name] : undefined;
  if (!entry || stored.version !== version || entryFingerprint(entry) !== fingerprint) return { ok: false, reason: "changed" };
  const refs = new Set(credentialRefsOf(entry));
  if (Object.keys(credentials).some((k) => !refs.has(k))) return { ok: false, reason: "unknown_credential" };
  for (const [k, v] of Object.entries(credentials)) if (v) await d.setCredential(personId, k, v);
  if (!(await d.approve(personId, name, fingerprint, version))) return { ok: false, reason: "changed" };
  return { ok: true, state: await d.mount(personId, name) };
}

export type { McpApprovalCard } from "./approval-card";
import type { McpApprovalCard } from "./approval-card";
import { cleanIssuer } from "./oauth/remote-text";

export function hostOf(url: string): string {
  try {
    return new URL(url.replace(/\$\{credential:[A-Z0-9_]+\}/g, "x")).hostname;
  } catch {
    return url;
  }
}

/** The hostname where the person signs in: the authorization server discovered on mount, else what the entry names; null
 *  while nobody knows (a first sign-in of an entry that names none). It is never the MCP server's own host: that is where
 *  the tools are, not where the sign-in page is, and a card that said so would name the wrong site. What the server named
 *  is a server's own word: only an https URL is ever turned into a host to show (remote-text.ts). */
export function issuerHostOf(entry: McpServerEntry, authIssuer: string | null = null): string | null {
  // An entry that names its metadata document takes its endpoints from it: that document's host is where the sign-in is
  // (its issuer is served from its own origin, provider.ts), whatever else the entry or the server says.
  const named = entry.oauth?.authServerMetadataUrl ?? cleanIssuer(authIssuer) ?? entry.oauth?.authorizationServer?.[0] ?? null;
  return named === null ? null : hostOf(named);
}

/** Where an entry's client secret goes: to the authorization server's token endpoint — the host of its
 *  `oauth.authServerMetadataUrl` when it names one (that document lists the endpoints), else the hosts of its
 *  `oauth.authorizationServer` issuers — never to the MCP server. */
function authorizationHostsOf(entry: McpServerEntry): string[] {
  const o = entry.oauth;
  const hosts = o?.authServerMetadataUrl ? [hostOf(o.authServerMetadataUrl)] : (o?.authorizationServer?.map(hostOf) ?? []);
  return [...new Set(hosts)];
}

/** The hosts an entry sends the credential `name` to: the MCP server's for a key in its url or headers, the
 *  authorization server's for its client secret. */
function destinationHostsOf(entry: McpServerEntry, name: string): string[] {
  const hosts = new Set<string>();
  if (credentialRefs([entry.url, ...Object.values(entry.headers)].join(" ")).includes(name)) hosts.add(hostOf(entry.url));
  if (entry.oauth?.clientSecret && credentialRefs(entry.oauth.clientSecret).includes(name)) for (const h of authorizationHostsOf(entry)) hosts.add(h);
  return [...hosts].sort();
}

/** Entries the person approved as they are: their fingerprint is still the approved one. */
function approvedEntries(config: McpConfig, approved: Readonly<Record<string, string>>): [string, McpServerEntry][] {
  return Object.entries(config.servers).filter(([n, e]) => approved[n] === entryFingerprint(e));
}

export function buildApprovalCard(
  server: string,
  entry: McpServerEntry,
  config: McpConfig,
  approved: Readonly<Record<string, string>>,
  credentialsSet: ReadonlySet<string>,
  version: number,
  /** The file as it was before this write, with its approvals: the host a key went to before an entry was moved or
   *  replaced in the same write (the review's in-place-edit case). Absent where that is gone (the Herramientas page). */
  previous?: { readonly config: McpConfig; readonly approved: Readonly<Record<string, string>> },
  /** `OPENLEN_MCP_OAUTH=0` (spec local 2026-11-17-oauth-de-conectores-mcp, §8): nothing signs in, so no card offers it. */
  env: Readonly<Record<string, string | undefined>> = process.env,
): McpApprovalCard {
  const host = hostOf(entry.url);
  // Where each key goes today: the other approved entries now, and every approved entry before this write — the same
  // name included, whose old url is exactly the host a moved entry took the key from.
  const sources = [...approvedEntries(config, approved).filter(([n]) => n !== server), ...(previous ? approvedEntries(previous.config, previous.approved) : [])];
  const credentials = credentialRefsOf(entry).map((name) => {
    const destinationHosts = destinationHostsOf(entry, name);
    const citing = sources.flatMap(([, e]) => destinationHostsOf(e, name));
    const set = credentialsSet.has(name);
    return {
      name,
      set,
      // Where THIS entry sends it (a header's key to the MCP server, a client secret to the authorization server).
      destinationHosts,
      otherHosts: [...new Set(citing.filter((h) => !destinationHosts.includes(h)))].sort(),
      // A stored key that no approved entry sends to one of these hosts yet: approving sends it there for the first time.
      firstTime: set && destinationHosts.some((h) => !citing.includes(h)),
    };
  });
  const oauth = entry.oauth && oauthEnabled(env) ? { issuerHost: issuerHostOf(entry), reason: "first" as const } : undefined;
  return { server, host, headerNames: Object.keys(entry.headers).sort(), credentials, fingerprint: entryFingerprint(entry), version, ...(oauth ? { oauth } : {}) };
}
