import { Pool } from "pg";
import type { ArtifactDatabase, ArtifactSql } from "./types";

/** Lazy: importing tools must not connect to a DB or start workers. */
export function createArtifactDatabase(connectionString: string): ArtifactDatabase & { close(): Promise<void> } {
  const pool = new Pool({ connectionString, max: 2 });
  return {
    query: async (text, values = []) => (await pool.query(text, [...values])).rows,
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: ArtifactSql = { query: async (text, values = []) => (await client.query(text, [...values])).rows };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
