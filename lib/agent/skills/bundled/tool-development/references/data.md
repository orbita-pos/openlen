# A tool's data

## Its own

What the tool keeps (notes, a checklist, its settings) goes in its own backend, with migrations like any app here (`supabase migration new`, then push to the test database). The person using it is signed in, so policies use `auth.uid()`:

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  project_id text,
  body text not null,
  created_at timestamptz not null default now()
);
alter table notes enable row level security;
create policy "own notes" on notes for all using (owner = auth.uid()) with check (owner = auth.uid());
```

- In this project's canvas and your eyes, it uses the test database; once installed, its production one. Installing applies the migrations, with the same checks as publishing (the person confirms anything that deletes data).
- A `project` tool keeps its rows apart per project: store `context().project.id` and filter by it.

## The person's projects

- `projects()` lists what they can open. `forms`, `visits` and `query` only answer for projects they own (`role: "dueno"`); for others they reject with `owner_only` — say so in the tool.
- `query` is SELECT only, on production, read-only.

## Changing a production row

`update(projectId, { table, key, set, before })` changes one row of another project's production database:

- `key` names the row (`{ id: 12 }`), `set` the new values, `before` the values the person saw for every column in `set`.
- OpenLen shows the person the change («pendiente → confirmada») outside the tool. Nothing changes unless they press «Aplicar».
- Results: `{ status: "applied", row }`, `{ status: "declined" }` (they said no), `{ status: "changed", current }` (someone changed the row meanwhile: show `current` and let them try again), `{ status: "refused", reason }` — `draft_no_production` in the canvas and your eyes, `owner_only`, `bad_change`.
- Never call it without a press of the person behind it.
