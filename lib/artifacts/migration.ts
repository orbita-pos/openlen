/** Shared by the additive CLI migration and disposable Postgres contract tests. */
export const ARTIFACT_MIGRATION_SQL = `
create table if not exists "artifactRequests" (
 "id" text primary key, "projectId" text not null references "projects"("id") on delete cascade,
 "sourceMessageId" text not null, "createdBy" text not null references "users"("id"),
 "createdAt" timestamptz not null default now(), unique ("projectId","sourceMessageId"), unique ("id","projectId")
);
create table if not exists "artifacts" (
 "id" text primary key, "projectId" text not null references "projects"("id") on delete cascade,
 "requestId" text not null, "kind" text not null check ("kind" in ('dashboard','slides','image','motion')),
 "title" text not null, "brief" text not null, "createdBy" text not null references "users"("id"),
 "visibility" text not null check ("visibility" in ('owner','project')),
 "currentRevision" integer not null default 0 check ("currentRevision">=0),
 "lastReadyRevision" integer, "status" text not null default 'draft' check ("status" in ('draft','queued','running','validating','storing','ready','failed','cancelled','needs_attention')),
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 foreign key ("requestId","projectId") references "artifactRequests"("id","projectId") on delete cascade
);
create table if not exists "artifactRevisions" (
 "artifactId" text not null references "artifacts"("id") on delete cascade,
 "revision" integer not null check ("revision">=0), "files" jsonb not null default '{}',
 "manifest" jsonb not null default '{}', "dependencies" jsonb not null default '[]', "sourceRef" jsonb,
 "sealedAt" timestamptz, "createdAt" timestamptz not null default now(),
 "outputs" jsonb not null default '[]', "evidence" jsonb, primary key ("artifactId","revision")
);
alter table "artifacts" add column if not exists "itemKey" text;
create unique index if not exists "artifacts_request_item_idx" on "artifacts" ("requestId","itemKey");
create table if not exists "artifactJobs" (
 "id" text primary key, "artifactId" text not null references "artifacts"("id") on delete cascade,
 "revision" integer not null, "actorId" text references "users"("id"), "operation" text not null, "optionsHash" text not null, "options" jsonb not null default '{}',
 "status" text not null default 'queued' check ("status" in ('queued','running','validating','storing','completed','failed','cancelled','needs_attention')),
 "attempt" integer not null default 0, "workerId" text, "fencingToken" text, "leaseUntil" timestamptz,
 "cancelRequested" boolean not null default false, "externalStartedAt" timestamptz, "errorCode" text,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 foreign key ("artifactId","revision") references "artifactRevisions"("artifactId","revision") on delete cascade,
 unique ("artifactId","revision","operation","optionsHash")
);
create table if not exists "artifactEvents" (
 "cursor" bigserial primary key, "projectId" text not null references "projects"("id") on delete cascade,
 "requestId" text not null references "artifactRequests"("id") on delete cascade,
 "artifactId" text not null references "artifacts"("id") on delete cascade, "revision" integer not null,
 "type" text not null, "jobId" text references "artifactJobs"("id") on delete cascade,
 "createdAt" timestamptz not null default now()
);
create table if not exists "artifactEventReads" (
 "projectId" text not null references "projects"("id") on delete cascade,
 "userId" text not null references "users"("id") on delete cascade, "cursor" bigint not null default 0,
 primary key ("projectId","userId")
);
-- No FK: object cleanup must survive deletion of its project/job/revision.
create table if not exists "artifactObjectGarbage" (
 "key" text primary key, "artifactId" text not null, "revision" integer not null,
 "jobId" text not null, "fencingToken" text not null,
 "notBefore" timestamptz not null default (now()+interval '1 hour')
);
create index if not exists "artifactObjectGarbage_due_idx" on "artifactObjectGarbage" ("notBefore");
create index if not exists "artifacts_project_created_idx" on "artifacts" ("projectId","createdAt","id");
alter table "artifactJobs" add column if not exists "actorId" text references "users"("id");
alter table "artifactJobs" add column if not exists "diagnostics" jsonb not null default '[]';
create index if not exists "artifactJobs_claim_idx" on "artifactJobs" ("status","createdAt");
create index if not exists "artifactEvents_project_cursor_idx" on "artifactEvents" ("projectId","cursor");
create unique index if not exists "artifactEvents_job_type_idx" on "artifactEvents" ("jobId","type") where "jobId" is not null;
create or replace function openlen_artifact_sealed_revision() returns trigger language plpgsql as $$
begin
 if old."sealedAt" is not null and (new."files" is distinct from old."files" or new."manifest" is distinct from old."manifest" or new."dependencies" is distinct from old."dependencies" or new."sourceRef" is distinct from old."sourceRef" or new."sealedAt" is distinct from old."sealedAt") then
  raise exception 'sealed artifact revision is immutable' using errcode = '23514';
 end if;
 return new;
end $$;
drop trigger if exists artifact_sealed_revision on "artifactRevisions";
create trigger artifact_sealed_revision before update on "artifactRevisions" for each row execute function openlen_artifact_sealed_revision();
`;
