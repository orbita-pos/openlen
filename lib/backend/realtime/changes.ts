// postgres_changes de los canales: sus suscripciones en `realtime.subscription`
// y un sondeo por proyecto mientras alguien escucha. Como su `RealtimeChannel`
// (`pg_change_params`, `postgres_subscribe`, `push_postgres_changes_subscribed`)
// y el MessageDispatcher de cdc_rls (supabase/realtime @ f86df8c3, Apache-2.0):
// cada cambio va SÓLO a los canales cuyo id de suscripción está en los
// `subscription_ids` que devolvió `apply_rls`.

import { randomUUID } from "node:crypto";

import type { Channel, RealtimeProject } from "./channel";
import { changeData, ProjectPoller, type ChangeRow, type ChangeSource, type PollerTiming } from "./poller";
import { createSubscriptions, deleteSubscriptions, parseSubscriptionParams, SubscribeError, type SubscriptionParams } from "./subscriptions";

export type ChangeSourceFactory = (project: RealtimeProject) => ChangeSource | null;

interface ProjectChanges {
  readonly poller: ProjectPoller;
  /** uuid de la suscripción → canal e id del filtro (el que conoce el cliente). */
  readonly subs: Map<string, { readonly ch: Channel; readonly id: number }>;
}

export class PostgresChangesHub {
  private readonly projects = new Map<string, ProjectChanges>();
  /** El sondeo que está soltando su fuente, por proyecto: el siguiente no la
   *  abre hasta que acaba. El slot es UNO por proyecto (`realtime_<ref>`), como
   *  su ReplicationPoller, registrado uno por tenant. */
  private readonly stopping = new Map<string, Promise<void>>();

  constructor(
    private readonly o: {
      readonly changeSource?: ChangeSourceFactory;
      readonly timing: PollerTiming;
    },
  ) {}

  /** Su `postgres_subscribe`: da de alta (o actualiza los claims de) las
   *  suscripciones del canal y avisa con su `system`. */
  async subscribe(ch: Channel): Promise<void> {
    const wanted = ch.config.postgresChanges;
    if (wanted.length === 0) return;
    const project = ch.session.project;
    const parsed: { uuid: string; id: number; params: SubscriptionParams }[] = [];
    for (const p of wanted) {
      const r = parseSubscriptionParams(p);
      // Su `:malformed_subscription_params`: error fatal, sin reintento.
      if (!r.ok) return ch.session.pushSystem(ch, "postgres_changes", "error", r.error);
      const id = ch.postgresChangesIds.get(p)!;
      parsed.push({ uuid: ch.subscriptionUuids.get(id) ?? randomUUID(), id, params: r.params });
    }
    if (!project.db || !this.o.changeSource) {
      return ch.session.pushSystem(ch, "postgres_changes", "error", "Realtime was unable to connect to the project database");
    }
    try {
      await createSubscriptions(
        project.db,
        parsed.map((s) => ({ id: s.uuid, claims: ch.claims, params: s.params })),
      );
    } catch (err) {
      const message = err instanceof SubscribeError ? err.message : `Unable to subscribe to changes: ${(err as Error).message}`;
      return ch.session.pushSystem(ch, "postgres_changes", "error", message);
    }
    // Se fue mientras tanto: fuera lo que se acaba de dar de alta.
    if (!ch.session.channels.has(ch.topic) || ch.session.channels.get(ch.topic) !== ch) {
      await deleteSubscriptions(project.db, parsed.map((s) => s.uuid)).catch(() => {});
      return;
    }
    const state = this.ensure(project);
    if (!state) {
      await deleteSubscriptions(project.db, parsed.map((s) => s.uuid)).catch(() => {});
      return ch.session.pushSystem(ch, "postgres_changes", "error", "Realtime was unable to connect to the project database");
    }
    for (const s of parsed) {
      ch.subscriptionUuids.set(s.id, s.uuid);
      state.subs.set(s.uuid, { ch, id: s.id });
    }
    ch.session.pushSystem(ch, "postgres_changes", "ok", "Subscribed to PostgreSQL");
  }

  /** El canal se fue: sus suscripciones fuera, y si era el último del
   *  proyecto, el sondeo para (y con él el slot temporal). */
  async unsubscribe(ch: Channel): Promise<void> {
    const project = ch.session.project;
    const uuids = [...ch.subscriptionUuids.values()];
    if (uuids.length === 0) return;
    ch.subscriptionUuids.clear();
    const state = this.projects.get(project.ref);
    if (state) {
      for (const u of uuids) state.subs.delete(u);
      if (state.subs.size === 0) {
        this.projects.delete(project.ref);
        const stopped = state.poller.stop().catch((err: unknown) => console.error("[realtime] parar el sondeo", project.ref, err));
        this.stopping.set(project.ref, stopped);
        await stopped;
        if (this.stopping.get(project.ref) === stopped) this.stopping.delete(project.ref);
      }
    }
    if (project.db) await deleteSubscriptions(project.db, uuids).catch((err: unknown) => console.error("[realtime] borrar suscripciones", project.ref, err));
  }

  private ensure(project: RealtimeProject): ProjectChanges | null {
    const existing = this.projects.get(project.ref);
    if (existing) return existing;
    const source = this.o.changeSource?.(project);
    if (!source) return null;
    const subs = new Map<string, { ch: Channel; id: number }>();
    const poller = new ProjectPoller(
      source,
      (row) => this.dispatch(subs, row),
      this.o.timing,
      (err) => console.error("[realtime] sondeo", project.ref, err),
    );
    const state: ProjectChanges = { poller, subs };
    this.projects.set(project.ref, state);
    const previous = this.stopping.get(project.ref);
    if (previous) void previous.then(() => poller.start());
    else poller.start();
    return state;
  }

  /** Su MessageDispatcher de cdc_rls: a cada canal, los ids de SUS filtros
   *  que están entre los `subscription_ids` de la fila. */
  private dispatch(subs: Map<string, { ch: Channel; id: number }>, row: ChangeRow): void {
    const data = changeData(row);
    if (!data) return;
    const byChannel = new Map<Channel, number[]>();
    for (const uuid of row.subscription_ids) {
      const s = subs.get(uuid);
      if (!s) continue;
      const ids = byChannel.get(s.ch) ?? [];
      if (!ids.includes(s.id)) ids.push(s.id);
      byChannel.set(s.ch, ids);
    }
    for (const [ch, ids] of byChannel) ch.session.push(ch.topic, "postgres_changes", { ids, data }, ch.joinRef);
  }

  /** Al cerrar el servicio. */
  async closeAll(): Promise<void> {
    const all = [...this.projects.values()];
    this.projects.clear();
    await Promise.all([...all.map((s) => s.poller.stop().catch(() => {})), ...this.stopping.values()]);
  }
}
