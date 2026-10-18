import "server-only";
import { ArtifactError } from "./types";
import { createArtifactData } from "./data";
import { createArtifactContextCapture,createArtifactSourceFreeze } from "./context";
import { projectSourceLoader, queryProjectArtifactData } from "./project-data";
import {createArtifactCoreRuntime,artifactsEnabled} from "./runtime-core";
export {artifactsEnabled} from "./runtime-core";

export function createArtifactRuntime(env: Readonly<Record<string, string | undefined>>) {
  const core=createArtifactCoreRuntime(env);
  const load=projectSourceLoader(core.database);
  return {...core,data:createArtifactData(core.database,core.store,queryProjectArtifactData),captureContext:createArtifactContextCapture(core.database,load),freezeSource:createArtifactSourceFreeze(core.database,load)};
}
type Runtime = ReturnType<typeof createArtifactRuntime>;
const KEY = Symbol.for("openlen.artifacts.runtime");
type WithRuntime = typeof globalThis & { [KEY]?: Runtime };
export function getArtifactRuntime(): Runtime {
  if (!artifactsEnabled()) throw new ArtifactError("feature_disabled");
  const global = globalThis as WithRuntime;
  return global[KEY] ??= createArtifactRuntime(process.env);
}
