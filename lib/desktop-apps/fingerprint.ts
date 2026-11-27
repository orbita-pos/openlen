// «HAY UNA VERSIÓN NUEVA» (spec local 2026-11-26-apps-en-el-escritorio, §4.4): what an install uses is no longer what was
// installed. A fingerprint of it is kept in the row at install and compared with the current one, so nobody rebuilds anything to
// know. Claude's version is the artifact's WHOLE server-side version (`ver`): any change to what the installed thing runs bumps
// it — so here it is the files, the production public environment the build bakes in, and the production function secrets the
// install deploys. Pure and with no server imports: the install and the state both call it.
import { createHash, createHmac } from "node:crypto";

import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { esFicheroDeSupabase } from "@/lib/agent/ficheros/supabase";

/** What an install READS: what the release is built from (`isCompileInputPath`, the filter `buildToolRelease` uses) and
 *  the backend's files, which the gates migrate and deploy (`prepareFunctions` bundles `/supabase/functions/**` and
 *  `config.toml`; the data changes follow the migrations). 🔴 The migrations and functions never reach the release, but an
 *  app that lives only on the desktop has no publish to bring them to production: the install is it. */
const isInstallInput = (path: string): boolean => isCompileInputPath(path) || esFicheroDeSupabase(path);

/** sha256 of the shell (`html`) followed by the path and content of every file an install reads, in path order. A test,
 *  `/LEN.md` or Len's artifacts are in neither list, so editing them is not a new version — and an image of the folder is
 *  (it is served as it is), and so is a migration or a function (the gates deploy them). */
export function filesFingerprint(html: string, files: Record<string, string>): string {
  const hash = createHash("sha256");
  hash.update(`${html}\0`);
  for (const path of Object.keys(files).filter(isInstallInput).sort()) hash.update(`${path}\0${files[path]}\0`);
  return hash.digest("hex");
}

/** A production function secret as the store lists it: its name and its digest (what `supabase secrets list` shows). Never
 *  its value — there is nowhere in the install's dependencies to ask for one. */
export interface LiveSecret {
  readonly name: string;
  readonly digest: string;
}

const byName = (a: LiveSecret, b: LiveSecret): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The secrets as ONE keyed digest: an HMAC-SHA256, with the server's own secret, over the names and digests in name order. 🔴
 *  A secret's value is never an input and a plain hash of what is stored is never the output: a leaked database holds only
 *  this, and without the server's key it cannot be used to guess a weak secret offline. A secret saved again with the same
 *  value keeps its digest, so it is not a new version; a rotated, added or removed one is. */
export function secretsStamp(secrets: readonly LiveSecret[], key: string): string {
  const mac = createHmac("sha256", key);
  mac.update("openlen-desktop-secrets\0");
  mac.update(JSON.stringify([...secrets].sort(byName).map((s) => [s.name, s.digest])));
  return mac.digest("hex");
}

/** The version an install stores and a read compares: the files (`filesFingerprint`), the production public environment
 *  (`entornoPublicoDeLaApp(…, "production")`, which ends up in the JavaScript each visitor gets — public by contract, so
 *  plain) and the keyed stamp of the production function secrets. Key order is irrelevant everywhere. */
export function versionFingerprint(i: {
  readonly html: string;
  readonly files: Record<string, string>;
  readonly env: Readonly<Record<string, string>>;
  readonly secrets: readonly LiveSecret[];
  /** The server's key for the stamp (`versionKeyOrNull`, `deps.ts`). */
  readonly key: string;
}): string {
  const hash = createHash("sha256");
  hash.update(`files\0${filesFingerprint(i.html, i.files)}\0env\0`);
  hash.update(JSON.stringify(Object.keys(i.env).sort().map((name) => [name, i.env[name]])));
  hash.update(`\0secrets\0${secretsStamp(i.secrets, i.key)}`);
  return hash.digest("hex");
}
