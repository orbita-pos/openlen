// Keep existing query helpers on one transaction without threading a connection through every call.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
/** `open` turns false when the transaction's work ends: work it left running (a `void` call, a timer) inherits this
 *  scope, and the transaction's client goes back to the pool at commit, so that work uses the pool too. */
type Scope = { db: Database; after: (() => void)[]; open: boolean };

export function transactionScope(root: Database, transactional: () => Database = () => root) {
  const local = new AsyncLocalStorage<Scope>();
  const active = () => {
    const scope = local.getStore();
    return scope?.open ? scope : undefined;
  };
  const db = new Proxy(root, {
    get(target, key) {
      const current = active()?.db ?? target;
      const value = Reflect.get(current, key, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
  return {
    db,
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (active()) return work();
      const after: (() => void)[] = [];
      const value = await transactional().transaction(tx => {
        const scope: Scope = { db: tx as unknown as Database, after, open: true };
        return local.run(scope, async () => {
          try { return await work(); }
          finally { scope.open = false; }
        });
      }, { isolationLevel: "serializable" });
      for (const action of after) action();
      return value;
    },
    afterCommit(action: () => void) {
      const scope = active();
      if (scope) scope.after.push(action);
      else action();
    },
  };
}
