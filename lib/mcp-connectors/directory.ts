// THE CURATED CONNECTOR DIRECTORY (spec local 2026-11-17-oauth-de-conectores-mcp, §6, §10.3, §10.5): a short list of
// remote OAuth MCP servers that `suggest_connectors` offers when the person has none installed for what they asked.
// Google Calendar is offered only to someone who can finish the flow: `OPENLEN_MCP_GOOGLE_CLIENT_ID` must be set, and
// while `OPENLEN_MCP_GOOGLE_TEST_USERS` is set, the person's email must be in it.
import { entryFingerprint, parseMcpConfig, serializeMcpConfig, type McpConfig } from "./config";
import { DIRECTORY, GOOGLE_ISSUER, type DirectoryEntry } from "./directory-entries";
import { oauthEnabled } from "./oauth/enabled";
import { startSignIn, type StartDeps, type StartResult } from "./oauth/flow";
import type { StoredConfig } from "./store";

export { DIRECTORY, type DirectoryEntry } from "./directory-entries";

type Env = Readonly<Record<string, string | undefined>>;

export function directoryFor(personEmail: string | null, config: McpConfig, env: Env = process.env): DirectoryEntry[] {
  if (!oauthEnabled(env)) return [];
  const configuredUrls = new Set(Object.values(config.servers).map((e) => e.url));
  return DIRECTORY.filter((d) => {
    if (configuredUrls.has(d.entry.url)) return false;
    if (d.issuer === GOOGLE_ISSUER) {
      if (!env.OPENLEN_MCP_GOOGLE_CLIENT_ID?.trim()) return false;
      const testList = env.OPENLEN_MCP_GOOGLE_TEST_USERS?.trim();
      if (testList) {
        const email = personEmail?.trim().toLowerCase() ?? "";
        if (!email) return false;
        const allowed = testList
          .split(",")
          .map((u) => u.trim().toLowerCase())
          .filter(Boolean);
        if (!allowed.includes(email)) return false;
      }
    }
    return true;
  });
}

export interface DirectoryInstallDeps extends StartDeps {
  writeConfig(
    personId: string,
    text: string,
    expectedVersion: number,
    approve: Readonly<Record<string, string>>,
    presentNames: readonly string[],
  ): Promise<{ ok: true; version: number } | { ok: false; reason: "conflict" }>;
  installedServerNames(personId: string): Promise<ReadonlySet<string>>;
  /** The person's email, which the test-user list is checked against (directoryFor). */
  personEmail(personId: string): Promise<string | null>;
  readonly env?: Env;
}

function pickServerName(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * The person's tap on a suggestion card (spec §6, §10.3, §10.5): write the directory's entry, approve it, and start the
 * sign-in. Three things the tap never does:
 *  - install for someone the directory doesn't offer the entry to (their email, the deployment's client id): the entry
 *    doesn't exist for them, so it is a 404. The eligibility is checked against an EMPTY file — whether the person
 *    already has the server is a different question, answered below;
 *  - approve an entry that merely sits at the directory's URL. Len writes mcp.json, and an entry at Google's URL with a
 *    client or endpoints of its own is not what the card showed: only an entry whose fingerprint is exactly the
 *    directory's is approved and reused; otherwise the directory's own entry is written under another name beside it;
 *  - rewrite a file it can't read: a mcp.json that doesn't parse is the person's, and stays as it is.
 */
export async function installAndStartFromDirectory(
  personId: string,
  id: string,
  d: DirectoryInstallDeps,
): Promise<{ ok: true; server: string; authorizationUrl: string } | { ok: false; status: 400 | 404 | 409 | 422 | 502; error: string; detail?: string }> {
  const dir = DIRECTORY.find((x) => x.id === id);
  if (!dir) return { ok: false, status: 404, error: "not_found" };
  const email = await d.personEmail(personId).catch(() => null);
  if (!directoryFor(email, { servers: {} }, d.env).some((x) => x.id === id)) return { ok: false, status: 404, error: "not_found" };
  const [stored, reserved] = await Promise.all([d.readConfig(personId), d.installedServerNames(personId)]);
  const current = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  if (!current.ok) return { ok: false, status: 409, error: "config_unreadable", detail: current.error };
  const existingServers = current.config.servers;
  const canonical = parseMcpConfig(JSON.stringify({ servers: { [dir.server]: dir.entry } }), { reservedServerNames: new Set() });
  if (!canonical.ok) return { ok: false, status: 400, error: canonical.error };
  const canonicalFingerprint = entryFingerprint(canonical.config.servers[dir.server]!);
  const already = Object.entries(existingServers).find(([, e]) => entryFingerprint(e) === canonicalFingerprint);
  let serverName: string;
  if (already) {
    serverName = already[0];
    if (stored.approved[serverName] !== canonicalFingerprint) {
      const written = await d.writeConfig(personId, stored.text, stored.version, { [serverName]: canonicalFingerprint }, Object.keys(existingServers));
      if (!written.ok) return { ok: false, status: 409, error: "changed" };
    }
  } else {
    const taken = new Set([...Object.keys(existingServers), ...reserved]);
    serverName = pickServerName(dir.server, taken);
    const raw = {
      servers: {
        ...Object.fromEntries(Object.entries(existingServers).map(([n, e]) => [n, e])),
        [serverName]: dir.entry,
      },
    };
    const parsed = parseMcpConfig(`${JSON.stringify(raw, null, 2)}
`, { reservedServerNames: reserved });
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    const entry = parsed.config.servers[serverName]!;
    const written = await d.writeConfig(personId, serializeMcpConfig(parsed.config), stored.version, { [serverName]: entryFingerprint(entry) }, Object.keys(parsed.config.servers));
    if (!written.ok) return { ok: false, status: 409, error: "changed" };
  }
  const started: StartResult = await startSignIn(personId, serverName, d);
  if (started.ok) return { ok: true, server: serverName, authorizationUrl: started.authorizationUrl };
  const status = started.reason === "not_approved" ? 409 : started.reason === "no_client" ? 422 : 502;
  return { ok: false, status, error: started.reason, detail: started.error };
}
