-- Read-only: THE CUSTOMER CASES OF LEN 3.1's BATTERY 1 (spec local 2026-11-12-len-3-1-ruta, §5 piece 5; plan
-- local 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 7). Which real customer PAGE projects become cases:
-- «crear, editar y publicar una página», the flow customers actually use.
--
-- SAFETY — the rules of len-production-baseline.sql: ONE read-only transaction, statement_timeout 30 s,
-- lock_timeout 1 s, and NO TEXT LEAVES THE BOX: ids, counts, booleans and dates only. The cases' text is
-- fetched later, outside the repo (npm run bench:clientes:fetch).
--
-- RUN IT FROM THIS MACHINE (your own accounts are named when you run it, never written here):
--   ssh openlen "sudo -n -u postgres psql -d openlen -X -q -v mine=a@x.com,b@y.com" < scripts/measure/len-bench-customer-cases.sql
--
-- THE RULE, WRITTEN BEFORE LOOKING AT THE RESULT (plan, task 7):
--   * a customer's project (not `mine`, not QA), of kind PAGE (no app, game or tool), still existing;
--   * at least one Len turn the OWNER typed in its current chat (a row with no `tipo`, no `origen` —not started
--     by the server— in the conversation in course, not `en_curso`), since -v since (default 2026-09-01: from
--     2026-10-01 only 18 were eligible on 15/11, and the spec's §7.4 sizes the battery at 25 cases; widening the
--     window by DATE, decided on the count alone, picks no case by what it contains);
--   * left out, and counted apart: a project where an owner message carries a photo or a file (the bench does
--     not replay attachments; review focus 4 of the plan), and one where Len made an ARTIFACT (`create_artifact`:
--     a dashboard or a deck is another flow, and the project's page stays empty — case 25b92e46, found 15/11),
--     and one with an owner message typed while looking at a sub-page (the bench replays every message against
--     Home; review I4, none on 15/11);
--   * the rest, most recent first message first, up to 25.

\set ON_ERROR_STOP on
\pset pager off
\if :{?since}
\else
  \set since '2026-09-01'
\endif
\if :{?mine}
\else
  \set mine ''
\endif

set statement_timeout = '30s';
set lock_timeout = '1s';
begin transaction isolation level repeatable read read only;

select set_config('len.mine', :'mine', true) as a, set_config('len.since', :'since', true) as b \gset unused_

\set owner_rows 'owner_rows as (select m."projectId" as project_id, m.id, m."createdAt", (m."attachedImage" is not null and m."attachedImage" <> ''null''::jsonb and m."attachedImage" <> ''[]''::jsonb) or (m."attachedFiles" is not null and m."attachedFiles" <> ''[]''::jsonb) as attached, exists (select 1 from jsonb_array_elements(coalesce(m.transcript->''mensajes'', ''[]''::jsonb)) msg, jsonb_array_elements(coalesce(msg->''functionCalls'', ''[]''::jsonb)) fc where fc->>''name'' = ''create_artifact'') as artifact, coalesce(m.page, '''') <> '''' as subpage from "projectChatMessages" m where m.tipo is null and m.origen is null and m.conversation is null and m.status <> ''en_curso'' and m."createdAt" >= current_setting(''len.since'')::timestamp)'
\set candidates 'candidates as (select p.id as project_id, p.subdomain is not null as published, count(r.id) as owner_messages, bool_or(r.attached) as attached, bool_or(r.artifact) as artifact, bool_or(r.subpage) as subpage, min(r."createdAt") as first_at, max(r."createdAt") as last_at from projects p join users u on u.id = p."userId" join owner_rows r on r.project_id = p.id where not (u.email = any(string_to_array(current_setting(''len.mine''), '',''))) and u.email not like ''%@openlen.test'' and u.email <> ''showcase@openlen.com'' and not (p.data ? ''app'' or p.data ? ''game'' or p.data ? ''tool'') group by p.id, p.subdomain)'

\echo
\echo '== 0. What was asked =='
select :'since'::date as since, cardinality(string_to_array(nullif(:'mine', ''), ',')) as accounts_counted_as_mine;

\echo
\echo '== 1. Customer page projects with an owner-typed Len turn, and how many are left out (attachment, artifact) =='
with :owner_rows, :candidates
select count(*) as projects, count(*) filter (where attached) as left_out_attachment,
       count(*) filter (where artifact and not attached) as left_out_artifact,
       count(*) filter (where subpage and not attached and not artifact) as left_out_subpage,
       count(*) filter (where not attached and not artifact and not subpage) as eligible,
       count(*) filter (where not attached and not artifact and not subpage and published) as eligible_published
from candidates;

\echo
\echo '== 2. THE CASES: eligible, most recent first message first, up to 25 (ids, counts, dates) =='
with :owner_rows, :candidates
select project_id, owner_messages, published, first_at::date as first_day, last_at::date as last_day
from candidates where not attached and not artifact and not subpage order by first_at desc limit 25;

rollback;
