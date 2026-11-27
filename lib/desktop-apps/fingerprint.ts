// «HAY UNA VERSIÓN NUEVA» (spec local 2026-11-26-apps-en-el-escritorio, §4.4): the project's files are no longer the ones
// that were installed. A fingerprint of them is kept in the row at install and compared with the current one, so nobody
// rebuilds anything to know. Pure and with no server imports: the install and the state both call it.
import { createHash } from "node:crypto";

import { isCompileInputPath } from "@/lib/agent/ficheros/folder";

/** sha256 of the shell (`html`) followed by the path and content of every file the release is built from, in path
 *  order. 🔴 The rule is `isCompileInputPath`, the same filter `buildToolRelease` builds from: a test, `/LEN.md`, the
 *  migrations or Len's artifacts never reach the release, so editing them is not a new version — and an image of the
 *  folder does reach it (it is served as it is), so changing one is. */
export function filesFingerprint(html: string, files: Record<string, string>): string {
  const hash = createHash("sha256");
  hash.update(`${html}\0`);
  for (const path of Object.keys(files).filter(isCompileInputPath).sort()) hash.update(`${path}\0${files[path]}\0`);
  return hash.digest("hex");
}
