// El acceso a la base de un proyecto. Interfaces mínimas para que lo mismo
// corra contra `pg` (producción) y contra PGlite (pruebas).

export interface SqlRunner {
  /** Varias sentencias, sin parámetros (migraciones, arranque). */
  exec(sql: string): Promise<void>;
  /** Una sentencia con parámetros `$1…`. */
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type TxQuery = (
  sql: string,
  params?: readonly unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;

export interface ProjectDatabase {
  /** Una transacción: si `fn` lanza, se deshace y el error sigue su camino. */
  transaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T>;
}

/** Lanzarla dentro de una transacción la deshace y devuelve `value` a quien la
 *  abrió: lo que hace PostgREST cuando `.single()` no da una fila en una
 *  escritura, o `max-affected` se pasa. */
export class RollbackWith<T> extends Error {
  constructor(readonly value: T) {
    super("rollback");
  }
}

export async function transactionOrRollback<T>(db: ProjectDatabase, fn: (q: TxQuery) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (err) {
    if (err instanceof RollbackWith) return err.value as T;
    throw err;
  }
}
