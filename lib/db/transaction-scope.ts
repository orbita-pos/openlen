// Keep existing query helpers on one transaction without threading a connection through every call.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
export function transactionScope(root: Database, transactional: () => Database = () => root) {
  const local = new AsyncLocalStorage<{ db: Database; after: (() => void)[] }>();
  const db = new Proxy(root, {
    get(target, key) {
      const active = local.getStore()?.db ?? target;
      const value = Reflect.get(active, key, active);
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
  return {
    db,
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (local.getStore()) return work();
      const after: (() => void)[] = [];
      const value = await transactional().transaction(tx => local.run({ db: tx as unknown as Database, after }, work), { isolationLevel: "serializable" });
      for (const action of after) action();
      return value;
    },
    afterCommit(action: () => void) {
      const active = local.getStore();
      if (active) active.after.push(action);
      else action();
    },
  };
}
