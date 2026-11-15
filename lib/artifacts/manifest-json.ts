import { ArtifactError } from "./types";

/** A piece's manifest (dashboard.json, deck.json, motion.json, audio.json), parsed. One the revision does not have
 *  says so: it used to be read as "" and answered «is not JSON», which sent Len to fix a file it had not written. */
export function manifestJson(files: Readonly<Record<string, string>>, name: string, code: string): unknown {
  if (!Object.hasOwn(files, name)) throw new ArtifactError(code, `${name} does not exist yet: write it before rendering`);
  try { return JSON.parse(files[name]!); } catch { throw new ArtifactError(code, `${name} is not JSON`); }
}
