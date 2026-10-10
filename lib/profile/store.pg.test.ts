// @vitest-environment node
//
// 🔴 QUIÉN VE QUÉ EN UN PERFIL, CONTRA POSTGRES (docs/superpowers/specs/2026-10-10-profile-design.md):
// cada persona ve los proyectos que podría abrir de todos modos. Corre contra
// DATABASE_URL — en este plan, la base de usar y tirar.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getProfile, listProfileProjects, updateProfile } from "@/lib/profile/store";

const ANA = "prueba-perfil-ana";
const BEA = "prueba-perfil-bea";
const CARLOS = "prueba-perfil-carlos";
const OTRO = "prueba-perfil-otro";
const P = {
  pub: "prueba-perfil-pub",
  compartido: "prueba-perfil-compartido",
  sola: "prueba-perfil-sola",
  ajeno: "prueba-perfil-ajeno",
  blanco: "prueba-perfil-blanco",
  archivado: "prueba-perfil-archivado",
  extrano: "prueba-perfil-extrano",
};
const USUARIOS = [ANA, BEA, CARLOS, OTRO];
const ids = (r: { projects: { id: string }[] }) => r.projects.map((p) => p.id).sort();

beforeEach(async () => {
  vi.stubEnv("PUBLISH_BASE_HOST", "openlen.app");
  await db.delete(schema.projects).where(inArray(schema.projects.id, Object.values(P)));
  await db.delete(schema.users).where(inArray(schema.users.id, USUARIOS));
  await db.insert(schema.users).values([
    { id: ANA, email: `${ANA}@ejemplo.invalido`, name: "Ana", handle: "pruebaperfil_ana", image: "https://lh3.googleusercontent.com/a/ana" },
    { id: BEA, email: `${BEA}@ejemplo.invalido`, name: "Bea", handle: "pruebaperfil_bea" },
    { id: CARLOS, email: `${CARLOS}@ejemplo.invalido`, name: "Carlos" },
    { id: OTRO, email: `${OTRO}@ejemplo.invalido`, name: "Otro" },
  ]);
  const con = (html: string) => ({ html });
  await db.insert(schema.projects).values([
    { id: P.pub, userId: ANA, title: "Pública", brief: "", data: con("<p>p</p>"), visibility: "public", status: "published", subdomain: "prueba-perfil-pub" },
    { id: P.compartido, userId: ANA, title: "Con Bea", brief: "", data: con("<p>c</p>") },
    { id: P.sola, userId: ANA, title: "Sólo Ana", brief: "", data: con("<p>s</p>") },
    { id: P.ajeno, userId: OTRO, title: "De Otro, Ana lectora", brief: "", data: con("<p>a</p>") },
    { id: P.blanco, userId: ANA, title: "En blanco", brief: "", data: con("") },
    { id: P.archivado, userId: ANA, title: "Archivado", brief: "", data: con("<p>x</p>"), visibility: "public", status: "archived" },
    { id: P.extrano, userId: OTRO, title: "De Otro, sin Ana", brief: "", data: con("<p>e</p>") },
  ]);
  await db.insert(schema.projectMembers).values([
    { projectId: P.compartido, userId: BEA, rol: "editor" },
    { projectId: P.ajeno, userId: ANA, rol: "lector" },
  ]);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(schema.projects).where(inArray(schema.projects.id, Object.values(P)));
  await db.delete(schema.users).where(inArray(schema.users.id, USUARIOS));
});

describe("🔴 los proyectos de un perfil, según quién mira", () => {
  it("un desconocido, o sin sesión, sólo ve lo de Explorar", async () => {
    for (const quien of [null, CARLOS]) {
      const r = await listProfileProjects(ANA, quien);
      expect(ids(r)).toEqual([P.pub]);
      expect(r.sharedCount).toBe(0);
      expect(r.projects[0]).toMatchObject({ role: "dueno", shared: false, canOpen: false, deployUrl: "https://prueba-perfil-pub.openlen.app" });
    }
  });

  it("un compañero ve también el privado en el que están los dos, y nada más", async () => {
    const r = await listProfileProjects(ANA, BEA);
    expect(ids(r)).toEqual([P.compartido, P.pub].sort());
    expect(r.sharedCount).toBe(1);
    expect(r.projects.find((p) => p.id === P.compartido)).toMatchObject({ role: "dueno", shared: true, canOpen: true });
    expect(r.projects.find((p) => p.id === P.pub)).toMatchObject({ shared: false, canOpen: false });
  });

  it("uno mismo ve todos los suyos, con su papel; nunca el blanco ni el archivado", async () => {
    const r = await listProfileProjects(ANA, ANA);
    expect(ids(r)).toEqual([P.ajeno, P.compartido, P.pub, P.sola].sort());
    expect(r.sharedCount).toBe(0);
    expect(r.projects.find((p) => p.id === P.ajeno)?.role).toBe("lector");
    expect(r.projects.every((p) => p.canOpen && !p.shared)).toBe(true);
  });
});

describe("el perfil entero", () => {
  it("🔴 un fijado privado no le sale a quien no está en él, ni uno que ya no existe", async () => {
    await db.update(schema.users).set({ pinnedProjectIds: [P.sola, P.pub, "no-existe"] }).where(eq(schema.users.id, ANA));
    const extrano = await getProfile("pruebaperfil_ana", CARLOS);
    expect(extrano?.pinned.map((p) => p.id)).toEqual([P.pub]);
    expect(extrano?.projects.map((p) => p.id)).toEqual([]);
    expect(extrano).toMatchObject({ isSelf: false, hasCustomAvatar: false, avatar: "https://lh3.googleusercontent.com/a/ana" });
    const ella = await getProfile("pruebaperfil_ana", ANA);
    expect(ella?.pinned.map((p) => p.id)).toEqual([P.sola, P.pub]);
    expect(ella?.projects.map((p) => p.id)).not.toContain(P.sola);
    expect(ella?.isSelf).toBe(true);
  });

  it("🔴 la dirección en mayúsculas o con @@ lleva al mismo perfil; sin @ no hay perfil", async () => {
    expect((await getProfile("PruebaPerfil_Ana", null))?.userId).toBe(ANA);
    expect((await getProfile("@pruebaperfil_ana", null))?.userId).toBe(ANA);
    expect(await getProfile("no_existe_nadie", null)).toBeNull();
  });

  it("la foto subida gana, y sólo en el tuyo se dice que hay una subida", async () => {
    await db.update(schema.users).set({ avatarUrl: "https://uploads.openlen.com/avatars/x-0123456789abcdef.webp" }).where(eq(schema.users.id, ANA));
    expect((await getProfile("pruebaperfil_ana", ANA))?.hasCustomAvatar).toBe(true);
    expect((await getProfile("pruebaperfil_ana", BEA))).toMatchObject({ hasCustomAvatar: false, avatar: "https://uploads.openlen.com/avatars/x-0123456789abcdef.webp" });
  });
});

describe("guardar el perfil", () => {
  it("🔴 sólo se fijan proyectos en los que estás, sin repetir, hasta 6", async () => {
    await updateProfile(ANA, { pinnedProjectIds: [P.pub, P.extrano, P.pub, P.ajeno] });
    const [u] = await db.select({ p: schema.users.pinnedProjectIds }).from(schema.users).where(eq(schema.users.id, ANA));
    expect(u?.p).toEqual([P.pub, P.ajeno]);
  });

  it("🔴 un fijado del que dejas de ser miembro desaparece, y al guardar se cae", async () => {
    await updateProfile(ANA, { pinnedProjectIds: [P.ajeno, P.pub] });
    await db.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, P.ajeno));
    expect((await getProfile("pruebaperfil_ana", ANA))?.pinned.map((p) => p.id)).toEqual([P.pub]);
    await updateProfile(ANA, { pinnedProjectIds: [P.ajeno, P.pub] });
    const [u] = await db.select({ p: schema.users.pinnedProjectIds }).from(schema.users).where(eq(schema.users.id, ANA));
    expect(u?.p).toEqual([P.pub]);
  });

  it("nombre y bio vacíos se guardan como null; los enlaces como { url }", async () => {
    await updateProfile(ANA, { name: "", bio: "", links: ["https://ana.dev"] });
    const [u] = await db.select({ name: schema.users.name, bio: schema.users.bio, links: schema.users.links }).from(schema.users).where(eq(schema.users.id, ANA));
    expect(u).toEqual({ name: null, bio: null, links: [{ url: "https://ana.dev" }] });
  });
});
