// @vitest-environment node
//
// Las consultas de storage como el rol de la petición: lo que decide RLS, y lo
// que se hace como `supabase_storage_admin` (su `asSuperUser`).
import { beforeAll, describe, expect, it } from "vitest";

import { TEST_REF, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { asRole, asStorageAdmin, deleteObjects, findObject, insertObject, testPermission, upsertObject } from "./db";
import { StorageError } from "./errors";
import type { StorageContext } from "./handler";
import { storageLimits } from "./limits";
import { newStorageTestProject } from "./testing";

const MIGRACION = `
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "cada uno en su carpeta" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
`;
const U1 = "11111111-1111-4111-8111-111111111111";

let t: TestProject;
const ctx = (role: StorageContext["role"], claims: Record<string, unknown> = { role }): StorageContext => ({
  project: t.project,
  store: new MemoryBlobStore(),
  role,
  claims,
  jwt: "",
  limits: storageLimits({}),
  method: "POST",
  path: "/object/avatars/x",
});
beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
});

const objeto = (name: string) => ({ bucket_id: "avatars", name, owner: U1, version: "v1", metadata: { size: 3 }, user_metadata: null });
const cuantos = async () => (await t.pg.query<{ n: number }>(`select count(*)::int as n from storage.objects`)).rows[0]!.n;

describe("consultas de storage", () => {
  it("anon no puede subir donde la política no le deja: 403 de RLS, como Supabase", async () => {
    const err = await testPermission(ctx("anon"), (q) => insertObject(q, objeto("x.png"))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toMatchObject({ httpStatusCode: 403, code: "AccessDenied", message: "new row violates row-level security policy" });
  });

  it("testPermission deja pasar lo permitido y NO deja la fila", async () => {
    await testPermission(ctx("authenticated", { role: "authenticated", sub: U1 }), (q) => insertObject(q, objeto(`${U1}/x.png`)));
    expect(await cuantos()).toBe(0);
  });

  it("asStorageAdmin escribe sin RLS (la fila final de una subida)", async () => {
    const row = await asStorageAdmin(ctx("anon"), (q) => upsertObject(q, objeto(`${U1}/a.png`)));
    expect(row).toMatchObject({ bucket_id: "avatars", name: `${U1}/a.png`, owner: U1, owner_id: U1, version: "v1" });
    expect(await cuantos()).toBe(1);
    const again = await asStorageAdmin(ctx("anon"), (q) => upsertObject(q, { ...objeto(`${U1}/a.png`), version: "v2" }));
    expect(again.version).toBe("v2");
    expect(await cuantos()).toBe(1);
  });

  it("insertObject sobre uno que existe: KeyAlreadyExists", async () => {
    const err = await asStorageAdmin(ctx("anon"), (q) => insertObject(q, objeto(`${U1}/a.png`))).catch((e: unknown) => e);
    expect(err).toMatchObject({ httpStatusCode: 409, code: "KeyAlreadyExists" });
  });

  it("findObject: lo que RLS esconde es NoSuchKey; service_role lo ve", async () => {
    const err = await asRole(ctx("anon"), (q) => findObject(q, "avatars", `${U1}/a.png`)).catch((e: unknown) => e);
    expect(err).toMatchObject({ httpStatusCode: 404, code: "NoSuchKey", message: "Object not found" });
    const row = await asRole(ctx("service_role"), (q) => findObject(q, "avatars", `${U1}/a.png`));
    expect(row.name).toBe(`${U1}/a.png`);
  });

  it("deleteObjects pasa la guarda de borrado directo (la petición pone allow_delete_query)", async () => {
    const borradas = await asRole(ctx("service_role"), (q) => deleteObjects(q, "avatars", [`${U1}/a.png`, "no-existe.png"]));
    expect(borradas.map((r) => r.name)).toEqual([`${U1}/a.png`]);
    expect(await cuantos()).toBe(0);
  });

  it("los claims llegan como en Supabase: auth.uid() y storage.operation", async () => {
    const r = await asRole(ctx("authenticated", { role: "authenticated", sub: U1 }), async (q) =>
      (await q(`select auth.uid()::text as uid, current_setting('request.jwt.claim.role', true) as role, current_user as cu`)).rows[0],
    );
    expect(r).toEqual({ uid: U1, role: "authenticated", cu: "authenticated" });
  });

  it("el ref de la prueba", () => {
    expect(TEST_REF).toHaveLength(20);
  });
});
