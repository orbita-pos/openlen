// «HAY UNA VERSIÓN NUEVA» (spec local 2026-11-26-apps-en-el-escritorio, §4.4): the project's files are no longer the ones
// that were installed. A fingerprint of them is kept in the row at install and compared with the current one, so nobody
// rebuilds anything to know. Pure and with no server imports: the install and the state both call it.
import { createHash } from "node:crypto";

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
