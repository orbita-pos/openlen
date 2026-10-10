import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  dataChangesErrorBody,
  DataChangesFailedError,
  DataChangesNeedConfirmationError,
  DataChangesNeedOwnerError,
  publishDataChanges,
  type DataChangesDeps,
} from "./data-changes";
import type { EnvironmentRecord } from "./environments";

const REC = { projectId: "p1", ref: "abcdefghijklmnopqrst", dbPasswordEncrypted: "x" };
const env = (environment: "draft" | "live", provisioned = true): EnvironmentRecord => ({
  projectId: "p1",
  environment,
  scope: `abcdefghijklmnopqrst_${environment[0]}`,
  jwtSecretEncrypted: "j",
  readOnlyPasswordEncrypted: null,
  provisionedAt: provisioned ? new Date() : null,
});
const M = { version: "2", name: "sin_descuento", statements: ["alter table ventas drop column descuento"] };

function deps(over: Partial<DataChangesDeps> & { live?: EnvironmentRecord | null } = {}) {
  const calls: string[] = [];
  const live = over.live === undefined ? env("live") : over.live;
  const { live: _ignored, ...rest } = over;
  const d: DataChangesDeps = {
    getBackend: async () => REC,
    getEnvironment: async (_p, e) => (e === "draft" ? env("draft") : live),
    createEnvironment: async () => (calls.push("createEnvironment"), env("live", false)),
    markEnvironmentProvisioned: async () => void calls.push("mark"),
    deleteEnvironment: async () => void calls.push("deleteEnvironment"),
    credsOf: (_r, e) => ({ scope: e.scope, ref: REC.ref, password: "pw" }),
    pendingMigrations: async () => ({ ok: true, pending: [M] }),
    rehearse: async () => ({ ok: true, destructive: [], fingerprint: "f1" }),
    applyPending: async () => (calls.push("apply"), { ok: true }),
    createLiveDatabase: async (o) => void calls.push(`createLive:${o.copyData}`),
    dropLiveDatabase: async () => void calls.push("dropLive"),
    withPublishLock: (_ref, fn) => fn(),
    ...rest,
  };
  return { d, calls };
}

describe("publicar lleva las migraciones", () => {
  it("lo pendiente no destructivo se aplica", async () => {
    const { d, calls } = deps();
    await publishDataChanges({ projectId: "p1", mode: "owner" }, d);
    expect(calls).toEqual(["apply"]);
  });

  it("lo destructivo sin confirmar se detiene con su huella", async () => {
    const { d, calls } = deps({ rehearse: async () => ({ ok: true, destructive: [{ kind: "drop_column", table: "ventas", column: "descuento", count: 1240 }], fingerprint: "f1" }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "owner" }, d)).rejects.toBeInstanceOf(DataChangesNeedConfirmationError);
    expect(calls).toEqual([]);
  });

  it("lo destructivo con la huella buena se aplica, con copia de la tabla", async () => {
    const backups: string[][] = [];
    const { d } = deps({
      rehearse: async () => ({ ok: true, destructive: [{ kind: "drop_column", table: "ventas", column: "descuento", count: 1240 }], fingerprint: "f1" }),
      applyPending: async (_l, _p, o) => (backups.push([...o.backupTables]), { ok: true }),
    });
    await publishDataChanges({ projectId: "p1", mode: "owner", confirmFingerprint: "f1" }, d);
    expect(backups).toEqual([["ventas"]]);
  });

  it("una huella vieja vuelve a pedir confirmación", async () => {
    const { d } = deps({ rehearse: async () => ({ ok: true, destructive: [{ kind: "drop_table", table: "viejos", count: 3 }], fingerprint: "f2" }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "owner", confirmFingerprint: "f1" }, d)).rejects.toBeInstanceOf(DataChangesNeedConfirmationError);
  });

  it("una migración que falla en el ensayo no aplica nada", async () => {
    const { d, calls } = deps({ rehearse: async () => ({ ok: false, migration: "2_x", statementIndex: 0, statement: "s", error: { message: "boom" } }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "owner" }, d)).rejects.toBeInstanceOf(DataChangesFailedError);
    expect(calls).toEqual([]);
  });

  it("la republicación de sistema con algo pendiente no toca nada", async () => {
    const { d, calls } = deps();
    await expect(publishDataChanges({ projectId: "p1", mode: "system" }, d)).rejects.toBeInstanceOf(DataChangesNeedOwnerError);
    expect(calls).toEqual([]);
  });

  it("la republicación de sistema sin nada pendiente sigue", async () => {
    const { d } = deps({ pendingMigrations: async () => ({ ok: true, pending: [] }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "system" }, d)).resolves.toBeUndefined();
  });

  it("primera publicación: producción nace, se aplican las migraciones y se marca", async () => {
    const { d, calls } = deps({ live: null });
    await publishDataChanges({ projectId: "p1", mode: "owner", copyDraftData: false }, d);
    expect(calls).toEqual(["createEnvironment", "createLive:false", "apply", "mark"]);
  });

  it("primera publicación que falla: no queda producción a medias", async () => {
    const { d, calls } = deps({ live: null, rehearse: async () => ({ ok: false, migration: "2_x", statementIndex: 0, statement: "s", error: { message: "boom" } }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "owner" }, d)).rejects.toBeInstanceOf(DataChangesFailedError);
    expect(calls).toEqual(["createEnvironment", "createLive:false", "dropLive", "deleteEnvironment"]);
  });

  it("sin borrador usado, no hay nada que llevar", async () => {
    const { d, calls } = deps({ getEnvironment: async () => null });
    await publishDataChanges({ projectId: "p1", mode: "system" }, d);
    expect(calls).toEqual([]);
  });

  it("producción con migraciones que el borrador no tiene: divergencia", async () => {
    const { d } = deps({ pendingMigrations: async () => ({ ok: false, diverged: ["9"] }) });
    await expect(publishDataChanges({ projectId: "p1", mode: "owner" }, d)).rejects.toBeInstanceOf(DataChangesFailedError);
  });
});

describe("lo que contesta la ruta", () => {
  it("428 con la huella; 422 si falla o diverge; null si no es nuestro", () => {
    expect(dataChangesErrorBody(new DataChangesNeedConfirmationError([], "f"))?.status).toBe(428);
    expect(dataChangesErrorBody(new DataChangesFailedError({ kind: "diverged", versions: ["9"] }))?.body.error).toBe("migrations_diverged");
    expect(dataChangesErrorBody(new DataChangesFailedError({ kind: "failed", migration: "m", statement: "s", message: "x" }))?.body.error).toBe("migration_failed");
    expect(dataChangesErrorBody(new Error("otro"))).toBeNull();
  });
});
