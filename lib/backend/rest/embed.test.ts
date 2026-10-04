// @vitest-environment node
//
// Recursos embebidos de /rest/v1 (`select('*, autor:authors(name)')`) con la
// librería real. Las relaciones salen de las claves foráneas, como en
// PostgREST (SchemaCache.hs: allM2OandO2ORels + addM2MRels; Plan.hs: findRel).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { handleBackendRequest } from "../router";
import { newTestProject, TEST_URL, type TestProject } from "../testing/project";

const MIGRACION = `
create table public.authors (id int primary key, name text not null);
create table public.books (
  id int primary key,
  title text not null,
  author_id int not null references public.authors(id),
  editor_id int references public.authors(id)
);
create table public.tags (id int primary key, name text not null);
create table public.book_tags (
  book_id int references public.books(id),
  tag_id int references public.tags(id),
  primary key (book_id, tag_id)
);
create table public.bios (author_id int primary key references public.authors(id), text text);
create table public.series (id int primary key, name text);
create table public.series_books (series_id int references public.series(id), book_id int references public.books(id));

insert into public.authors values (1, 'Rulfo'), (2, 'Castellanos'), (3, 'Nadie');
insert into public.books values (10, 'Pedro Páramo', 1, 2), (11, 'El llano en llamas', 1, null), (12, 'Balún Canán', 2, 1);
insert into public.tags values (100, 'novela'), (101, 'cuentos'), (102, 'clásico');
insert into public.book_tags values (10, 100), (10, 102), (11, 101), (12, 100);
insert into public.bios values (1, 'Jalisco, 1917');
`;

let t: TestProject;
let db: SupabaseClient;

beforeAll(async () => {
  t = await newTestProject(MIGRACION);
  db = createClient(TEST_URL, t.project.publishableKey, {
    global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), t.project) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

describe("embebidos", () => {
  it("🔴 muchos-a-uno: el libro con su autor (un objeto), por la columna como pista", async () => {
    const { data, error } = await db.from("books").select("title, author:authors!author_id(name)").order("id");
    expect(error).toBeNull();
    expect(data).toEqual([
      { title: "Pedro Páramo", author: { name: "Rulfo" } },
      { title: "El llano en llamas", author: { name: "Rulfo" } },
      { title: "Balún Canán", author: { name: "Castellanos" } },
    ]);
  });

  it("🔴 uno-a-muchos: el autor con sus libros (un array, vacío si no tiene)", async () => {
    const { data, error } = await db.from("authors").select("name, books!author_id(title)").order("id");
    expect(error).toBeNull();
    expect(data).toEqual([
      { name: "Rulfo", books: [{ title: "Pedro Páramo" }, { title: "El llano en llamas" }] },
      { name: "Castellanos", books: [{ title: "Balún Canán" }] },
      { name: "Nadie", books: [] },
    ]);
  });

  it("🔴 ambiguo sin pista: PGRST201 con 300, y la pista por nombre de restricción lo resuelve", async () => {
    const amb = await db.from("books").select("title, authors(name)");
    expect(amb.status).toBe(300);
    expect(amb.error).toMatchObject({
      code: "PGRST201",
      message: "Could not embed because more than one relationship was found for 'books' and 'authors'",
    });
    const { data } = await db.from("books").select("title, editor:authors!books_editor_id_fkey(name)").eq("id", 10);
    expect(data).toEqual([{ title: "Pedro Páramo", editor: { name: "Castellanos" } }]);
  });

  it("uno-a-uno: la bio del autor es un objeto (null si no hay)", async () => {
    const { data } = await db.from("authors").select("name, bios(text)").order("id").limit(2);
    expect(data).toEqual([
      { name: "Rulfo", bios: { text: "Jalisco, 1917" } },
      { name: "Castellanos", bios: null },
    ]);
  });

  it("🔴 muchos-a-muchos por la tabla puente, y anidado", async () => {
    const { data, error } = await db.from("authors").select("name, books!author_id(title, tags(name))").eq("id", 1);
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        name: "Rulfo",
        books: [
          { title: "Pedro Páramo", tags: [{ name: "novela" }, { name: "clásico" }] },
          { title: "El llano en llamas", tags: [{ name: "cuentos" }] },
        ],
      },
    ]);
  });

  it("una puente sin la clave primaria de sus dos columnas NO es muchos-a-muchos: PGRST200", async () => {
    const { error, status } = await db.from("books").select("title, series(name)");
    expect(status).toBe(400);
    expect(error).toMatchObject({ code: "PGRST200", message: "Could not find a relationship between 'books' and 'series' in the schema cache" });
  });

  it("filtros, orden y límite DENTRO del embebido (referencedTable)", async () => {
    const { data } = await db
      .from("authors")
      .select("name, books!author_id(title)")
      .eq("id", 1)
      .order("title", { referencedTable: "books" })
      .limit(1, { referencedTable: "books" });
    expect(data).toEqual([{ name: "Rulfo", books: [{ title: "El llano en llamas" }] }]);
    const f = await db.from("authors").select("name, books!author_id(title)").eq("books.title", "Balún Canán").order("id").limit(2);
    expect(f.data).toEqual([
      { name: "Rulfo", books: [] },
      { name: "Castellanos", books: [{ title: "Balún Canán" }] },
    ]);
  });

  it("🔴 !inner: el filtro del embebido filtra a los padres", async () => {
    const { data, error } = await db.from("authors").select("name, books!author_id!inner(title)").eq("books.title", "Balún Canán");
    expect(error).toBeNull();
    expect(data).toEqual([{ name: "Castellanos", books: [{ title: "Balún Canán" }] }]);
  });

  it("spread: los campos de un a-uno, aplanados", async () => {
    const { data } = await db.from("books").select("title, ...authors!author_id(author_name:name)").eq("id", 12);
    expect(data).toEqual([{ title: "Balún Canán", author_name: "Castellanos" }]);
  });

  it("un filtro sobre un embebido que no está en el select: PGRST108", async () => {
    const { error } = await db.from("authors").select("name").eq("books.title", "x");
    expect(error).toMatchObject({ code: "PGRST108", hint: "Verify that 'books' is included in the 'select' query parameter." });
  });

  it("en una escritura: insert(...).select() con su embebido", async () => {
    const { data, error } = await db.from("books").insert({ id: 13, title: "Oficio de tinieblas", author_id: 2 }).select("title, author:authors!author_id(name)").single();
    expect(error).toBeNull();
    expect(data).toEqual({ title: "Oficio de tinieblas", author: { name: "Castellanos" } });
  });
});
