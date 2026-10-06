// El Janitor de Realtime: las particiones diarias de `realtime.messages` (las
// de los canales privados) no se quedan para siempre. Como su
// `Realtime.Tenants.Janitor` y su `MaintenanceTask` (supabase/realtime @
// f86df8c3, Apache-2.0): cada pasada, a cada proyecto, `delete_old_messages`
// (fuera las particiones de hace más de 72 horas) y `create_messages_partitions`
// (las de los días que vienen). Sus valores por defecto (`config/runtime.exs`):
// JANITOR_SCHEDULE_TIMER_IN_MS 4 h, JANITOR_RUN_AFTER_IN_MS 10 min.

import type { ProjectDatabase } from "../db";
import { ensureMessagePartitions, forgetMessagePartitions, projectsWithMessages } from "./authorization";

/** Su `NaiveDateTime.add(-72, :hour)`. */
const KEEP_MS = 72 * 3600 * 1000;
/** Lo que crea su `create_messages_partitions`: `messages_<aaaa>_<mm>_<dd>`. */
const PARTITION_NAME = /^messages_(\d{4})_(\d{2})_(\d{2})$/;

/** Su `delete_old_messages`: las particiones de `realtime.messages` de antes
 *  del día de hace 72 horas, fuera. Su consulta, con el esquema del padre
 *  también mirado; un nombre que no es un día se salta (ellos fallan). */
export async function deleteOldMessages(db: ProjectDatabase, now = new Date()): Promise<void> {
  const limit = new Date(now.getTime() - KEEP_MS).toISOString().slice(0, 10);
  await db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_realtime_admin', true)`);
    const r = await q(
      `SELECT child.relname
       FROM pg_catalog.pg_inherits
       JOIN pg_catalog.pg_class parent ON pg_inherits.inhparent = parent.oid
       JOIN pg_catalog.pg_class child ON pg_inherits.inhrelid = child.oid
       JOIN pg_catalog.pg_namespace nmsp_parent ON nmsp_parent.oid = parent.relnamespace
       JOIN pg_catalog.pg_namespace nmsp_child ON nmsp_child.oid = child.relnamespace
       WHERE parent.relname = 'messages'
       AND nmsp_parent.nspname = 'realtime'
       AND nmsp_child.nspname = 'realtime'`,
    );
    for (const row of r.rows) {
      const name = String(row.relname);
      const m = PARTITION_NAME.exec(name);
      if (!m || `${m[1]}-${m[2]}-${m[3]}` >= limit) continue;
      await q(`DROP TABLE IF EXISTS realtime."${name}"`);
    }
  });
}

export interface JanitorOptions {
  /** Su JANITOR_SCHEDULE_TIMER_IN_MS (4 h). */
  readonly scheduleMs?: number;
  /** Su JANITOR_RUN_AFTER_IN_MS (10 min). */
  readonly startAfterMs?: number;
  readonly onError?: (err: unknown, ref: string) => void;
}

/** Su Janitor: a cada proyecto con canales privados en este proceso (su tenant
 *  conectado al nodo), su MaintenanceTask. La primera pasada, a los
 *  `startAfterMs` (ellos: un ciclo entero más esa espera; aquí el servicio se
 *  reinicia en cada deploy y un ciclo de 4 h podría no llegar nunca). */
export class MessagesJanitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private running: Promise<void> | null = null;
  private readonly scheduleMs: number;
  private readonly startAfterMs: number;
  private readonly onError: (err: unknown, ref: string) => void;

  constructor(o: JanitorOptions = {}) {
    this.scheduleMs = o.scheduleMs ?? 4 * 3600 * 1000;
    this.startAfterMs = o.startAfterMs ?? 10 * 60 * 1000;
    this.onError = o.onError ?? ((err, ref) => console.error("[realtime] janitor", ref, err));
  }

  start(): void {
    this.schedule(this.startAfterMs);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.runOnce()
        .catch((err: unknown) => this.onError(err, "*"))
        .finally(() => {
          this.running = null;
          this.schedule(this.scheduleMs);
        });
    }, ms);
    this.timer.unref?.();
  }

  /** Una pasada: lo viejo fuera y los días que vienen. Una base que ya no
   *  contesta (el proyecto se borró) sale de la lista y no frena a las demás. */
  async runOnce(now = new Date()): Promise<void> {
    for (const [ref, db] of projectsWithMessages()) {
      try {
        await deleteOldMessages(db, now);
        await ensureMessagePartitions(db, ref, now);
      } catch (err) {
        this.onError(err, ref);
        forgetMessagePartitions(ref);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
