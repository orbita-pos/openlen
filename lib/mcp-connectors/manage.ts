// THE PERSON MANAGES THEIR CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.7): DeepSeek's Settings → MCP — list with
// status, add, edit, enable, disable, delete, probe — on the Herramientas page. What the person writes is validated like
// what Len writes and is approved by writing it. What the page reads never carries a header value or a key: it gets
// header NAMES, whether each key is set, and for a server Len added, the same «Conectar» card the chat shows.
import { buildApprovalCard, hostOf, type McpApprovalCard } from "./approval";
import { entryFingerprint, parseMcpConfig, serializeMcpConfig, type McpConfig, type McpServerEntry } from "./config";
import type { ServerState, StoredConfig } from "./store";

export interface ManageDeps {
  read(personId: string): Promise<StoredConfig>;
  write(
    personId: string,
    text: string,
    expectedVersion: number,
    approve: Readonly<Record<string, string>>,
    presentNames: readonly string[],
  ): Promise<{ ok: true; version: number } | { ok: false; reason: "conflict" }>;
  readStates(personId: string): Promise<ServerState[]>;
  deleteState(personId: string, serverName: string): Promise<void>;
  credentialNames(personId: string): Promise<{ name: string; updatedAt: Date }[]>;
  setCredential(personId: string, name: string, value: string): Promise<void>;
  installedServerNames(personId: string): Promise<ReadonlySet<string>>;
  mount(personId: string, name: string): Promise<ServerState | null>;
}

export type ServerStatus = "connected" | "pending" | "waiting-credentials" | "failed" | "never-listed";

export interface ServerView {
  readonly name: string;
  readonly host: string;
  /** As written: a key in it can only be a `${credential:NAME}` reference (config.ts refuses one in clear). */
  readonly url: string;
  readonly enabled: boolean;
  readonly approved: boolean;
  readonly status: ServerStatus;
  readonly tools: number;
  readonly headers: readonly string[];
  readonly error?: string;
  readonly listedAt?: string;
  /** For a server Len added or changed that the person hasn't approved: the card to approve it. */
  readonly approval?: McpApprovalCard;
}

export interface ConnectorsView {
  readonly version: number;
  readonly servers: readonly ServerView[];
  readonly credentials: readonly { readonly name: string; readonly updatedAt: string }[];
}

function configOf(stored: StoredConfig): McpConfig {
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  return parsed.ok ? parsed.config : { servers: {} };
}

export function serverView(name: string, entry: McpServerEntry, approved: boolean, state: ServerState | undefined): Omit<ServerView, "approval"> {
  const fp = entryFingerprint(entry);
  const current = state && state.fingerprint === fp ? state : undefined;
  const status: ServerStatus = !approved
    ? "pending"
    : current?.status === "waiting-credentials"
      ? "waiting-credentials"
      : current?.status === "failed"
        ? "failed"
        : current?.listedAt
          ? "connected"
          : "never-listed";
  return {
    name,
    host: hostOf(entry.url),
    url: entry.url,
    enabled: entry.enabled,
    approved,
    status,
    tools: current?.tools.length ?? 0,
    headers: Object.keys(entry.headers).sort(),
    ...(current?.error ? { error: current.error } : {}),
    ...(current?.listedAt ? { listedAt: current.listedAt.toISOString() } : {}),
  };
}

export async function listView(personId: string, d: ManageDeps): Promise<ConnectorsView> {
  const [stored, states, creds] = await Promise.all([d.read(personId), d.readStates(personId), d.credentialNames(personId)]);
  const config = configOf(stored);
  const stateOf = new Map(states.map((s) => [s.serverName, s]));
  const set = new Set(creds.map((c) => c.name));
  const servers = Object.entries(config.servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => {
      const approved = stored.approved[name] === entryFingerprint(entry);
      const view = serverView(name, entry, approved, stateOf.get(name));
      return approved ? view : { ...view, approval: buildApprovalCard(name, entry, config, stored.approved, set, stored.version) };
    });
  return { version: stored.version, servers, credentials: creds.map((c) => ({ name: c.name, updatedAt: c.updatedAt.toISOString() })) };
}

export function secretCredentialName(server: string, header: string): string {
  return `${server}_${header}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
}

export interface EntryInput {
  readonly url: string;
  /** Plain header values. Omitted: the stored headers are kept (the page never had their values). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Header → its whole value, typed by the person, stored as a key; the file gets `${credential:<SERVER>_<HEADER>}`. */
  readonly secretHeaders?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  /** Edit: `headers` are added over the stored ones instead of replacing them (the page never had their values). */
  readonly mergeHeaders?: boolean;
  readonly version: number;
}

type Saved = { ok: true; view: Omit<ServerView, "approval"> } | { ok: false; status: 400 | 409; error: string };

export async function saveEntry(personId: string, name: string, input: EntryInput, d: ManageDeps): Promise<Saved> {
  const stored = await d.read(personId);
  if (stored.version !== input.version) return { ok: false, status: 409, error: "changed" };
  const config = configOf(stored);
  const before = config.servers[name];
  const secret = Object.fromEntries(Object.entries(input.secretHeaders ?? {}).filter(([, v]) => v !== ""));
  const headers: Record<string, string> = input.mergeHeaders ? { ...(before?.headers ?? {}), ...(input.headers ?? {}) } : { ...(input.headers ?? before?.headers ?? {}) };
  for (const h of Object.keys(secret)) headers[h] = `\${credential:${secretCredentialName(name, h)}}`;
  const raw = {
    servers: {
      ...Object.fromEntries(Object.entries(config.servers).map(([n, e]) => [n, e])),
      [name]: { ...(before ?? {}), transport: "streamable-http", url: input.url, headers, enabled: input.enabled ?? before?.enabled ?? true },
    },
  };
  const text = `${JSON.stringify(raw, null, 2)}\n`;
  const parsed = parseMcpConfig(text, { reservedServerNames: await d.installedServerNames(personId) });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  for (const [h, v] of Object.entries(secret)) await d.setCredential(personId, secretCredentialName(name, h), v);
  const entry = parsed.config.servers[name]!;
  const written = await d.write(personId, serializeMcpConfig(parsed.config), stored.version, { [name]: entryFingerprint(entry) }, Object.keys(parsed.config.servers));
  if (!written.ok) return { ok: false, status: 409, error: "changed" };
  const state = (await d.mount(personId, name)) ?? undefined;
  return { ok: true, view: serverView(name, entry, true, state) };
}

export async function removeEntry(personId: string, name: string, version: number, d: ManageDeps): Promise<{ ok: true } | { ok: false; status: 409; error: string }> {
  const stored = await d.read(personId);
  if (stored.version !== version) return { ok: false, status: 409, error: "changed" };
  const config = configOf(stored);
  const servers = Object.fromEntries(Object.entries(config.servers).filter(([n]) => n !== name));
  const written = await d.write(personId, serializeMcpConfig({ servers }), version, {}, Object.keys(servers));
  if (!written.ok) return { ok: false, status: 409, error: "changed" };
  await d.deleteState(personId, name);
  return { ok: true };
}
