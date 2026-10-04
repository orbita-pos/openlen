// El acceso a la base de un proyecto. Una interfaz mínima para que lo mismo
// corra contra `pg` (producción) y contra PGlite (pruebas).

export interface SqlRunner {
  /** Varias sentencias, sin parámetros (migraciones, arranque). */
  exec(sql: string): Promise<void>;
  /** Una sentencia con parámetros `$1…`. */
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
