import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { AtomicCurateCommitError, commitCurateProjectAndDebit } from "./atomic-curate-commit";

const INPUT = {
  projectId: "project-atomic",
  userId: "user-atomic",
  title: "Atomic page",
  brief: "A sufficiently descriptive brief",
  profileId: "profile-atomic",
  logoUrl: null,
  credits: 5,
  data: { html: "<!doctype html><html><body>safe</body></html>" },
};

describe("commitCurateProjectAndDebit", () => {
  it("emits one writable CTE that debits and inserts, with no compensating delete", async () => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [{ id: INPUT.projectId }] }));

    await expect(commitCurateProjectAndDebit(INPUT, { execute })).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledOnce();
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(compiled.sql.trim()).toMatch(/^with\s+"?debited"?\s+as\s*\(\s*update\s+"users"/i);
    expect(compiled.sql).toMatch(/greatest\(0,\s*"credits"\s*-\s*\$\d+\)/i);
    expect(compiled.sql).toMatch(/insert\s+into\s+"projects"/i);
    expect(compiled.sql).toMatch(/select[\s\S]+from\s+"?debited"?/i);
    expect(compiled.sql).not.toMatch(/delete/i);
    expect(compiled.params).toEqual(expect.arrayContaining([INPUT.projectId, INPUT.userId, INPUT.credits, JSON.stringify(INPUT.data)]));
  });

  it("fails closed when a missing user yields no debited row and no project", async () => {
    const state = { credits: 10, projects: [] as string[] };
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }));
    await expect(commitCurateProjectAndDebit(INPUT, { execute })).rejects.toMatchObject({
      name: "AtomicCurateCommitError", code: "not_committed", message: "atomic_curate_commit_not_committed",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(state).toEqual({ credits: 10, projects: [] });
  });

  it.each([
    { ...INPUT, credits: 0 },
    { ...INPUT, credits: 1.5 },
    { ...INPUT, projectId: "" },
  ])("validates bounded commit data before touching the database", async (candidate) => {
    const execute = vi.fn();
    await expect(commitCurateProjectAndDebit(candidate, { execute })).rejects.toMatchObject({ code: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("surfaces insert/statement failure as a safe typed error with no observable partial mutation", async () => {
    const state = { credits: 10, projects: [] as string[] };
    const execute = vi.fn(async (_query: SQL) => {
      // PostgreSQL rolls back the debit CTE if the later INSERT fails.
      throw new Error("private insert constraint detail");
    });

    await expect(commitCurateProjectAndDebit(INPUT, { execute })).rejects.toEqual(
      new AtomicCurateCommitError("statement_failed"),
    );
    expect(state).toEqual({ credits: 10, projects: [] });
  });

  it("rejects an insufficient balance atomically without debit or project", async () => {
    const state = { credits: 1, projects: [] as string[] };
    const execute = vi.fn(async (_query: SQL) => {
      // Mirrors UPDATE ... WHERE credits >= charge: no debited row means the
      // INSERT ... SELECT also inserts nothing.
      return { rows: [] };
    });

    await expect(commitCurateProjectAndDebit(INPUT, { execute })).rejects.toMatchObject({ code: "not_committed" });
    expect(state).toEqual({ credits: 1, projects: [] });
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(compiled.sql).toMatch(/and\s+"credits"\s*>=\s*\$\d+/i);
  });

  it("allows an exact-balance charge to reach zero and create the project atomically", async () => {
    const state = { credits: INPUT.credits, projects: [] as string[] };
    const execute = vi.fn(async (_query: SQL) => {
      state.credits -= INPUT.credits;
      state.projects.push(INPUT.projectId);
      return { rows: [{ id: INPUT.projectId }] };
    });

    await commitCurateProjectAndDebit(INPUT, { execute });
    expect(state).toEqual({ credits: 0, projects: [INPUT.projectId] });
  });
});
