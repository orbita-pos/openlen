// Which terminal a turn gets, and how it closes (spec local 2026-10-21-real-terminal-e2b, §4, §8, §9).
//
// The real one (a box on E2B) when it is on, the account may use it, the project fits in a box, no
// other turn holds the project's box, OpenLen's daily cap allows it and the box opens. Otherwise
// today's, and — unless it is off on purpose — Len reads one line saying so. The user's own
// terminal (the Code lens) is always today's, as Claude Code's cloud gives the user no shell.
//
// No heavy imports on purpose: what needs the project (its files, /.openlen, the bridge's
// handlers, saving through Write's guards) comes in from herramienta.ts, so this runs in vitest.

import { randomUUID } from "node:crypto";

import type { TerminalBackend } from "@/lib/agent/terminal/backend";
import type { SalidaDeUnComando } from "@/lib/agent/terminal/terminal";
import type { AgentSession } from "@/lib/agent/tools";

import { chargeSandbox } from "./billing";
import type { BoxNetwork } from "./box-network";
import type { BridgeHandlers } from "./bridge";
import { sandboxBudgetOk, spentTodayMicroUsd } from "./budget";
import { sandboxConfig } from "./config";
import type { SandboxDriver, SandboxHandle } from "./driver";
import { e2bDriver } from "./e2b-driver";
import type { Manifest } from "./manifest";
import { conflictingTopLevel } from "./paths";
import { SandboxTerminal } from "./sandbox-terminal";
import * as rows from "./store";

/** One line, first in the output of the turn's first command, when the real terminal isn't there. */
export const LIMITED_TERMINAL_NOTICE =
  "This turn's terminal is the limited one: it interprets commands, with no processes and no network.";

/** The same, when the box stopped in the middle of the turn. */
export const BOX_STOPPED_NOTICE =
  "The box stopped, so the rest of this turn uses the limited terminal: it interprets commands, with no processes and no network. The working directory, the variables and background commands were lost; the files were not.";

export interface SandboxStore {
  get(projectId: string): Promise<rows.ProjectSandboxRow | null>;
  hold(projectId: string, turnId: string): Promise<boolean>;
  save(row: Parameters<typeof rows.saveProjectSandbox>[0]): Promise<void>;
  release(projectId: string, turnId: string): Promise<void>;
}

const postgresStore: SandboxStore = {
  get: rows.getProjectSandbox,
  hold: rows.holdProjectSandbox,
  save: rows.saveProjectSandbox,
  release: rows.releaseProjectSandbox,
};

export interface TurnTerminalOptions {
  /** Today's terminal, built the way herramienta.ts always did. */
  readonly local: () => TerminalBackend;
  readonly projectFiles: () => Promise<Record<string, string>>;
  readonly readOnly: () => Promise<Readonly<Record<string, string>>>;
  readonly bridge: () => Promise<BridgeHandlers>;
  /** The project's OpenLen hosts the box may reach, with its marker (./box-network.ts); `null` = none. */
  readonly network?: () => Promise<BoxNetwork | null>;
  /** This turn's variables for every command of the box (BASE_URL: the draft, for the tests). */
  readonly baseEnv?: () => Promise<Readonly<Record<string, string>>>;
  readonly signal?: AbortSignal;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly driver?: SandboxDriver;
  readonly store?: SandboxStore;
  readonly budgetOk?: () => Promise<boolean>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

type Charge = typeof chargeSandbox;
type Save = (pending: Readonly<Record<string, string | null>>) => Promise<void>;

/** The turn's real terminal: the box, and today's terminal behind it if the box dies. */
export class TurnSandbox implements TerminalBackend {
  private current: TerminalBackend;
  private diedAt: number | null = null;
  private settled = false;

  constructor(
    readonly inner: SandboxTerminal,
    private readonly ctx: {
      readonly session: AgentSession;
      readonly turnId: string;
      readonly local: () => TerminalBackend;
      readonly store: SandboxStore;
      readonly template: string;
      readonly handle: SandboxHandle;
      readonly startedAt: number;
      readonly now: () => number;
      readonly log: (line: string) => void;
    },
  ) {
    this.current = inner;
  }

  get arrancada(): boolean {
    return this.current.arrancada;
  }

  async ejecutar(command: string, o?: { readonly timeoutMs?: number; readonly background?: boolean }): Promise<SalidaDeUnComando> {
    if (this.diedAt !== null) return this.current.ejecutar(command, o);
    try {
      return await this.inner.ejecutar(command, o);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Like a shell that lost its state: if the box still answers, the error was this command's and
      // the box stays; the next command syncs again. Only a box that doesn't answer is given up.
      if (await this.answers()) return { stdout: "", stderr: `${message}\n`, exitCode: 1, ficheros: null };
      this.diedAt = this.ctx.now();
      this.current = this.ctx.local();
      this.ctx.session.sandboxNotice = BOX_STOPPED_NOTICE;
      this.ctx.log(`[sandbox] fallback project=${this.ctx.session.projectId} reason=died`);
      return { stdout: "", stderr: `The box stopped: ${message}\n`, exitCode: 1, ficheros: null };
    }
  }

  private async answers(): Promise<boolean> {
    try {
      return (await this.ctx.handle.run("true", { timeoutMs: 15_000 })).exitCode === 0;
    } catch {
      return false;
    }
  }

  refrescarPerezosos(): Promise<void> {
    return this.current.refrescarPerezosos();
  }

  poner(ficheros: Readonly<Record<string, string | null>>): Promise<void> {
    return this.current.poner(ficheros);
  }

  cerrar(): Promise<void> {
    return this.current.cerrar();
  }

  /** What finished in the box's background since the last look (loop.ts `lateNotices`). */
  async finishedBackground(): Promise<string[]> {
    return this.diedAt === null ? this.inner.finishedBackground() : [];
  }

  /** Box seconds this turn: until the pause, or until it died. */
  seconds(): number {
    return this.diedAt === null ? this.inner.runningSeconds() : Math.max(0, (this.diedAt - this.ctx.startedAt) / 1000);
  }

  /** The turn is ending: what still runs in the background is stopped (Claude Code's Bash in a session
   *  nobody wakes up later), and what the box changed since the last command is saved like any other
   *  write. Before the turn's last photo, so it belongs to the turn (its changes, its undo). Once. */
  async settle(save?: Save): Promise<void> {
    if (this.settled || this.diedAt !== null) return;
    this.settled = true;
    await this.inner.killBackground().catch(() => undefined);
    try {
      const pending = await this.inner.pendingChanges();
      if (Object.keys(pending).length > 0 && save) await save(pending);
    } catch (e) {
      this.ctx.log(`[sandbox] could not save the box's last changes project=${this.ctx.session.projectId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async close(o: { readonly save?: Save; readonly store?: SandboxStore; readonly charge?: Charge; readonly now?: () => number }): Promise<void> {
    const { session, turnId } = this.ctx;
    const store = o.store ?? this.ctx.store;
    const now = o.now ?? this.ctx.now;
    try {
      if (this.diedAt !== null) {
        await this.current.cerrar().catch(() => undefined);
        return;
      }
      await this.settle(o.save);
      await this.inner.cerrar().catch((e: unknown) => this.ctx.log(`[sandbox] pause failed project=${session.projectId}: ${String(e)}`));
      await store.save({
        projectId: session.projectId,
        sandboxId: this.ctx.handle.id,
        template: this.ctx.template,
        state: "paused",
        syncedManifest: this.inner.syncedManifest(),
        pausedAt: new Date(now()),
      });
    } finally {
      await store.release(session.projectId, turnId).catch(() => undefined);
      await (o.charge ?? chargeSandbox)({
        userId: session.userId,
        actorId: session.personId ?? null,
        projectId: session.projectId,
        turnId,
        seconds: this.seconds(),
      }).catch((e: unknown) => this.ctx.log(`[sandbox] charge failed project=${session.projectId}: ${String(e)}`));
    }
  }
}

export async function terminalForTurn(session: AgentSession, o: TurnTerminalOptions): Promise<TerminalBackend> {
  if (session.autor === "usuario") return o.local();
  const config = sandboxConfig(o.env ?? process.env);
  if (!config) return o.local();
  const log = o.log ?? ((line: string) => console.log(line));
  const now = o.now ?? Date.now;
  const fallback = (reason: string, notice = true): TerminalBackend => {
    log(`[sandbox] fallback project=${session.projectId} reason=${reason}`);
    if (notice) session.sandboxNotice = LIMITED_TERMINAL_NOTICE;
    return o.local();
  };
  if (config.onlyUsers && !config.onlyUsers.includes(session.userId)) return fallback("only_users", false);

  const projectFiles = await o.projectFiles();
  if (conflictingTopLevel(Object.keys(projectFiles)).length > 0) return fallback("conflict");

  const turnId = (session.turnId ??= randomUUID());
  const store = o.store ?? postgresStore;
  const openingAt = now();
  if (!(await store.hold(session.projectId, turnId))) return fallback("held");
  try {
    const budgetOk = o.budgetOk ?? (() => sandboxBudgetOk({ now: new Date(now()), dailyUsd: config.dailyUsd, spentTodayMicroUsd }));
    if (!(await budgetOk())) {
      await store.release(session.projectId, turnId);
      return fallback("budget");
    }
    const driver = o.driver ?? e2bDriver(config);
    const row = await store.get(session.projectId);
    const network = (await o.network?.().catch(() => null)) ?? null;
    let handle: SandboxHandle | undefined;
    let synced: Manifest = {};
    if (row?.sandboxId && row.template === config.template) {
      try {
        handle = await driver.resume(row.sandboxId, network);
        synced = row.syncedManifest;
      } catch {
        handle = undefined; // gone (reclaimed, killed): a new one below
      }
    }
    const resumed = handle !== undefined;
    if (!handle) {
      if (row?.sandboxId) void driver.kill(row.sandboxId).catch(() => undefined);
      handle = await driver.create({ template: config.template, metadata: { projectId: session.projectId }, network });
    }
    const startedAt = now();
    log(`[sandbox] open project=${session.projectId} ${resumed ? "resumed" : "created"} ms=${startedAt - openingAt}`);
    await store.save({ projectId: session.projectId, sandboxId: handle.id, template: config.template, state: "running", syncedManifest: synced, pausedAt: null });
    session.fotoDeLaTerminal = { ...projectFiles };
    const inner = new SandboxTerminal({
      handle,
      projectFiles,
      syncedManifest: synced,
      bridge: await o.bridge(),
      readOnly: o.readOnly,
      startedAt,
      signal: o.signal,
      now,
      logFirstSync: (timings) => log(`[sandbox] first sync project=${session.projectId} ${timings}`),
      fresh: !resumed,
      baseEnv: (await o.baseEnv?.().catch(() => ({}))) ?? {},
    });
    return new TurnSandbox(inner, { session, turnId, local: o.local, store, template: config.template, handle, startedAt, now, log });
  } catch (e) {
    await store.release(session.projectId, turnId).catch(() => undefined);
    log(`[sandbox] could not open the box project=${session.projectId}: ${e instanceof Error ? e.message : String(e)}`);
    return fallback("open_failed");
  }
}

/** Before the turn's last photo: the box stops its background work and saves what is pending. */
export async function settleTurnTerminal(session: AgentSession, o: { readonly save?: Save }): Promise<void> {
  if (session.terminal instanceof TurnSandbox) await session.terminal.settle(o.save);
}

/** Closes the turn's terminal: the box saves what is pending (if not settled yet), pauses, is let go and charged. */
export async function closeTurnTerminal(
  session: AgentSession,
  o: { readonly save?: Save; readonly store?: SandboxStore; readonly charge?: Charge; readonly now?: () => number },
): Promise<void> {
  const t = session.terminal;
  session.terminal = undefined;
  session.fotoDeLaTerminal = undefined;
  if (!t) return;
  if (t instanceof TurnSandbox) await t.close(o);
  else await t.cerrar();
}
