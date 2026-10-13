// The .d.ts files of the app's esm.sh packages (from the lock, out of the
// cache), laid out under /node_modules like the catalog's types.json.
import { readPackageJson, sourceOf } from "./lock";
import { defaultModuleStore, type ModuleStore } from "./store";

export async function npmTypesFor(files: Readonly<Record<string, string>>, catalogName: string, store: ModuleStore = defaultModuleStore()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(readPackageJson(files)?.dependencies ?? {})) {
    const source = sourceOf(name, files, catalogName);
    if (source.kind !== "esm" || !source.locked.types) continue;
    for (const [p, sha] of Object.entries(source.locked.types)) {
      const text = await store.get(sha);
      if (text !== null) out[p] = text;
    }
  }
  return out;
}
