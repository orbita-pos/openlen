// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): what OpenLen — never the model — shows the person
// before a server Len added or changed connects. DeepSeek asks approval for every change to the profile's plugins; here
// the tap approves one entry's fingerprint. A credential is a name of the person any entry may cite, as in DeepSeek, so
// the card names each key the server would receive and, in red, any other host that already gets it.
import { entryFingerprint, type McpConfig, type McpServerEntry } from "./config";
import { credentialRefsOf } from "./templates";

export interface McpApprovalCard {
  readonly server: string;
  readonly host: string;
  readonly headerNames: readonly string[];
  readonly credentials: readonly { readonly name: string; readonly set: boolean; readonly otherHosts: readonly string[] }[];
  readonly fingerprint: string;
  /** The config version the card was drawn from: the tap approves only if the file is still there. */
  readonly version: number;
}

export function hostOf(url: string): string {
  try {
    return new URL(url.replace(/\$\{credential:[A-Z0-9_]+\}/g, "x")).hostname;
  } catch {
    return url;
  }
}

export function buildApprovalCard(
  server: string,
  entry: McpServerEntry,
  config: McpConfig,
  approved: Readonly<Record<string, string>>,
  credentialsSet: ReadonlySet<string>,
  version: number,
): McpApprovalCard {
  const host = hostOf(entry.url);
  const credentials = credentialRefsOf(entry).map((name) => {
    const otherHosts = Object.entries(config.servers)
      .filter(([other, e]) => other !== server && approved[other] === entryFingerprint(e) && credentialRefsOf(e).includes(name))
      .map(([, e]) => hostOf(e.url))
      .filter((h) => h !== host);
    return { name, set: credentialsSet.has(name), otherHosts: [...new Set(otherHosts)].sort() };
  });
  return { server, host, headerNames: Object.keys(entry.headers).sort(), credentials, fingerprint: entryFingerprint(entry), version };
}
