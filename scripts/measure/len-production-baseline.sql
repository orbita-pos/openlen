-- Read-only measurement: THE PHOTO OF PRODUCTION for Len 3.1 (route spec local
-- 2026-11-12-len-3-1-ruta, piece 4). What Len's turns are, cost and fail at in
-- production, from the layer-0 telemetry (`agentRequestSteps`, one row per provider
-- call since 2026-10-26) joined to the chat rows. It is the «before» column of the
-- 3.1 table and the list of failures SEEN in production, as numbers that can be
-- taken again after a deploy: run it before and after, and compare.
--
-- SAFETY — the rules of len-turn-credits.sql (a SELECT without a timeout once ran
-- 17 h on this box and queued a deploy's ALTER behind it):
--   * ONE read-only transaction, rolled back at the end;
--   * statement_timeout 60 s, lock_timeout 1 s;
--   * NO TEXT LEAVES THE BOX: counts, sums, percentiles and machine fields only
--     (tool names, error codes, end reasons). No message, address or account is
--     printed; project and turn ids are not printed either.
--
-- RUN IT ON THE BOX (copy the file to /tmp first):
--   sudo -u postgres psql -d openlen -X -f /tmp/len-production-baseline.sql
-- Your own accounts are counted apart from customers. Name them when you run it —
-- they are never written in this file (comma-separated, no spaces):
--   sudo -u postgres psql -d openlen -X -v mine=me@example.com,other@example.com -f /tmp/len-production-baseline.sql
-- Other parameters, with their defaults:
--   -v since='2026-10-26'      first day counted (the day the step telemetry started)
--   -v in_usd=0.20 -v cached_usd=0.006 -v out_usd=0.60
--                              USD per million tokens (DeepInfra's LIST price of
--                              Len's model on 2026-11-12, without its discount)
-- From this machine, without copying anything:
--   ssh openlen "sudo -n -u postgres psql -d openlen -X -v mine=…" < scripts/measure/len-production-baseline.sql
--
-- WHAT IS COUNTED. A Len turn = the rows of `agentRequestSteps` with one `turnId`
-- and no `subagentId` (the main thread; subagents and the page assistant's visitors
-- are counted apart). `inputTokens` INCLUDES the cached ones: uncached = input −
-- cached. A turn's flow is how it started: `first` / `followup` when the owner typed
-- it (first or later turn of its conversation), or the kind of what started it on the
-- server (`scheduled`, `subagents`, `len_watch`…). Classes: `mine` (the -v mine
-- accounts), `qa` (the test and showcase accounts), `customer` (everyone else).
-- USD is the model's price for those tokens, not what was charged: credits are.
-- Section 9 (13/11, spec local 2026-11-13-conversar-todo-el-mes, piece E): what coming back after a pause
-- costs — the first call of each turn by how long its conversation had been quiet (quiet = since the
-- previous turn that called the model ended), and the turns that sent their history trimmed, which is
-- what the cold return does (lib/agent/cold-return.ts; its cache drops show in section 4 as `cold_trim`).

\set ON_ERROR_STOP on
\pset pager off
\pset null '-'
\if :{?since}
\else
  \set since '2026-10-26'
\endif
\if :{?mine}
\else
  \set mine ''
\endif
\if :{?in_usd}
\else
  \set in_usd 0.20
\endif
\if :{?cached_usd}
\else
  \set cached_usd 0.006
\endif
\if :{?out_usd}
\else
  \set out_usd 0.60
\endif

set statement_timeout = '60s';
set lock_timeout = '1s';
set idle_in_transaction_session_timeout = '5min';
begin transaction isolation level repeatable read read only;

-- The parameters as settings of this transaction, so the pieces below can read them.
select set_config('len.mine', :'mine', true) as a, set_config('len.since', :'since', true) as b,
       set_config('len.in_usd', :'in_usd', true) as c, set_config('len.cached_usd', :'cached_usd', true) as d,
       set_config('len.out_usd', :'out_usd', true) as e \gset unused_

-- The three pieces every section is made of (psql pastes them where :name appears).
\set classes 'classes as (select p.id as project_id, p."userId" as owner_id, p.status as project_status, case when u.email = any(string_to_array(current_setting(''len.mine''), '','')) then ''mine'' when u.email like ''%@openlen.test'' or u.email = ''showcase@openlen.com'' then ''qa'' else ''customer'' end as class, case when p.data ? ''tool'' then ''tool'' when p.data ? ''game'' then ''game'' when p.data ? ''app'' then ''app'' else ''page'' end as kind from projects p join users u on u.id = p."userId")'
\set turns 'turns as (select s."turnId" as turn_id, s."projectId" as project_id, count(*) as calls, sum(greatest(coalesce(s."inputTokens", 0) - coalesce(s."cachedTokens", 0), 0)) as uncached, sum(coalesce(s."cachedTokens", 0)) as cached, sum(coalesce(s."outputTokens", 0)) as output, sum(s."durationMs") / 1000.0 as model_secs, (sum(greatest(coalesce(s."inputTokens", 0) - coalesce(s."cachedTokens", 0), 0)) * current_setting(''len.in_usd'')::numeric + sum(coalesce(s."cachedTokens", 0)) * current_setting(''len.cached_usd'')::numeric + sum(coalesce(s."outputTokens", 0)) * current_setting(''len.out_usd'')::numeric) / 1e6 as usd from "agentRequestSteps" s where s."subagentId" is null and s."createdAt" >= current_setting(''len.since'')::timestamp group by 1, 2)'
\set flows 'flows as (select m.id as turn_id, coalesce(m.origen->>''kind'', case when row_number() over (partition by m."projectId", coalesce(m.conversation, '''') order by m."createdAt") = 1 then ''first'' else ''followup'' end) as flow, m.centicredits, m."durationMs" as wall_ms from "projectChatMessages" m where m.tipo is null)'

\echo
\echo '== 0. Which database, its clock, and what was asked =='
select current_database() as db, now() as now, :'since'::date as since,
       cardinality(string_to_array(nullif(:'mine', ''), ',')) as accounts_counted_as_mine,
       :'in_usd' as usd_per_m_input, :'cached_usd' as usd_per_m_cached, :'out_usd' as usd_per_m_output;

\echo
\echo '== 1. Coverage: provider calls recorded, and whose =='
select case when "subagentId" is null then 'len' when "subagentId" like 'assistant-visitor:%' then 'assistant-visitor' else 'subagent' end as who,
       count(*) as calls, count(distinct "turnId") as turns, count(distinct "projectId") as projects,
       min("createdAt")::date as first_day, max("createdAt")::date as last_day
from "agentRequestSteps" where "createdAt" >= :'since'::timestamp group by 1 order by 2 desc;

\echo
\echo '== 2. Len turns by who owns the project and what the project is =='
with :classes, :turns
select coalesce(c.class, 'project deleted') as class, coalesce(c.kind, '-') as kind,
       count(*) as turns, count(distinct t.project_id) as projects, sum(t.calls) as calls,
       round(sum(t.usd)::numeric, 3) as usd_at_list
from turns t left join classes c on c.project_id = t.project_id group by 1, 2 order by 3 desc;

\echo
\echo '== 3. THE TABLE: one row per flow (class, kind of project, how the turn started) =='
\echo '   calls = provider calls of the turn; tokens and seconds are per turn; credits = what the turn was charged'
with :classes, :turns, :flows
select c.class, c.kind, f.flow, count(*) as turns,
       round(percentile_cont(0.5) within group (order by t.calls)::numeric, 0) as calls_p50,
       round(percentile_cont(0.9) within group (order by t.calls)::numeric, 0) as calls_p90,
       round(percentile_cont(0.5) within group (order by t.uncached)::numeric, 0) as uncached_p50,
       round(percentile_cont(0.5) within group (order by t.cached)::numeric, 0) as cached_p50,
       round(percentile_cont(0.5) within group (order by t.output)::numeric, 0) as output_p50,
       round(percentile_cont(0.5) within group (order by f.wall_ms)::numeric / 1000, 0) as secs_p50,
       round(percentile_cont(0.9) within group (order by f.wall_ms)::numeric / 1000, 0) as secs_p90,
       round(percentile_cont(0.5) within group (order by f.centicredits)::numeric / 100, 2) as credits_p50,
       round(avg(t.usd)::numeric, 4) as usd_mean,
       round(percentile_cont(0.5) within group (order by t.usd)::numeric, 4) as usd_p50,
       round(percentile_cont(0.9) within group (order by t.usd)::numeric, 4) as usd_p90
from turns t join flows f on f.turn_id = t.turn_id join classes c on c.project_id = t.project_id
group by 1, 2, 3 order by 1, 2, 3;

\echo
\echo '== 4. The prompt cache: how much of what Len sent was read from it, and what broke it =='
select round(100.0 * sum(coalesce("cachedTokens", 0)) / nullif(sum(coalesce("inputTokens", 0)), 0), 1) as read_from_cache_pct,
       sum(coalesce("inputTokens", 0)) as input_tokens, sum(coalesce("cachedTokens", 0)) as cached_tokens,
       count(*) as calls, count(*) filter (where jsonb_typeof("cacheBreak") = 'object') as calls_with_a_break
from "agentRequestSteps" where "subagentId" is null and "createdAt" >= :'since'::timestamp;

\echo '   by cause (a break with two causes is in both rows)'
select cause, count(*) as calls, count(distinct s."turnId") as turns,
       sum((s."cacheBreak"->>'prevCached')::numeric - (s."cacheBreak"->>'cached')::numeric) as tokens_lost
from "agentRequestSteps" s, jsonb_array_elements_text(s."cacheBreak"->'causes') cause
where s."subagentId" is null and s."createdAt" >= :'since'::timestamp and jsonb_typeof(s."cacheBreak") = 'object'
group by 1 order by 2 desc;

\echo
\echo '== 5. How Len turns ended =='
select coalesce(x."endReason", '(none recorded)') as end_reason, count(*) as turns
from (select distinct on ("turnId") "turnId", "endReason" from "agentRequestSteps"
      where "subagentId" is null and "createdAt" >= :'since'::timestamp order by "turnId", step desc) x
group by 1 order by 2 desc;

\echo
\echo '== 6. Tools: what Len called, and what failed =='
select t->>'name' as tool, count(*) as calls, count(*) filter (where (t->>'ok')::boolean is false) as failed,
       round(100.0 * count(*) filter (where (t->>'ok')::boolean is false) / count(*), 1) as failed_pct,
       count(distinct s."turnId") as turns
from "agentRequestSteps" s, jsonb_array_elements(case when jsonb_typeof(s.tools) = 'array' then s.tools else '[]'::jsonb end) t
where s."subagentId" is null and s."createdAt" >= :'since'::timestamp
group by 1 order by 2 desc limit 30;

\echo '   the failures, by tool and error code'
select t->>'name' as tool, coalesce(t->>'errorCode', '(no code)') as error_code, count(*) as calls, count(distinct s."turnId") as turns
from "agentRequestSteps" s, jsonb_array_elements(case when jsonb_typeof(s.tools) = 'array' then s.tools else '[]'::jsonb end) t
where s."subagentId" is null and s."createdAt" >= :'since'::timestamp and (t->>'ok')::boolean is false
group by 1, 2 order by 3 desc limit 30;

\echo
\echo '== 7. THE FAILURES SEEN IN PRODUCTION, one by one (route spec, section 2) =='
\echo '   F1 · a scheduled run sends the whole conversation uncached (kept as it is: both yardsticks run a reminder in its chat)'
with :turns, :flows
select count(*) as runs, round(percentile_cont(0.5) within group (order by t.uncached)::numeric, 0) as uncached_p50,
       round(percentile_cont(0.5) within group (order by t.cached)::numeric, 0) as cached_p50,
       round(percentile_cont(0.5) within group (order by t.output)::numeric, 0) as output_p50,
       round(percentile_cont(0.5) within group (order by f.centicredits)::numeric / 100, 2) as credits_p50,
       round(sum(t.usd)::numeric, 3) as usd_at_list
from turns t join flows f on f.turn_id = t.turn_id where f.flow = 'scheduled';

\echo '   F2 · publish refused the address the owner had just answered («you made that name up»)'
select count(*) filter (where r->>'tool' = 'publish') as publish_calls,
       count(*) filter (where r->>'tool' = 'publish' and (r->>'ok')::boolean is false) as failed,
       count(*) filter (where r->>'tool' = 'publish' and r->'respuesta'->>'error' like '%made that name up%') as refused_as_made_up,
       count(distinct m.id) filter (where r->>'tool' = 'publish' and r->'respuesta'->>'error' like '%made that name up%') as turns,
       count(distinct m."projectId") filter (where r->>'tool' = 'publish' and r->'respuesta'->>'error' like '%made that name up%') as projects
from "projectChatMessages" m, jsonb_array_elements(case when jsonb_typeof(m."toolResults") = 'array' then m."toolResults" else '[]'::jsonb end) r
where m.tipo is null and m."createdAt" >= :'since'::timestamp;

\echo '   F3 · Write or Edit on a file Len had not read'
select t->>'name' as tool, count(*) as calls, count(distinct s."turnId") as turns
from "agentRequestSteps" s, jsonb_array_elements(case when jsonb_typeof(s.tools) = 'array' then s.tools else '[]'::jsonb end) t
where s."subagentId" is null and s."createdAt" >= :'since'::timestamp and t->>'errorCode' = 'not_read'
group by 1 order by 2 desc;

\echo '   F5 · how subagents ended'
select status, count(*) as subagents, round(sum("chargedCenticredits") / 100.0, 2) as credits
from "subagentRuns" where "createdAt" >= :'since'::timestamptz group by 1 order by 2 desc;

\echo '   F7 · photos attached to a message that Len never saw, by where the photo lives'
with photos as (
  select m.id, coalesce(m.transcript->'unseenPhotos', '[]'::jsonb) ? (ph->>'url') as unseen,
         case when ph->>'url' ~ '^https?://(localhost|127[.]0[.]0[.]1)' then 'this server, by its internal address'
              when ph->>'url' like '/%' then 'a file of the project folder'
              else 'a public address' end as place
  from "projectChatMessages" m,
       jsonb_array_elements(case when jsonb_typeof(m."attachedImage") = 'array' then m."attachedImage" else jsonb_build_array(m."attachedImage") end) ph
  where m.tipo is null and m."attachedImage" is not null and m.transcript is not null and m."createdAt" >= :'since'::timestamp)
select place, count(*) as photos, count(*) filter (where unseen) as never_seen, count(distinct id) as turns from photos group by 1 order by 2 desc;

\echo
\echo '== 8. Customers: who used Len, and how far they got =='
with :classes
select count(distinct c.owner_id) as people, count(distinct m."projectId") as projects, count(*) as turns,
       count(distinct m."projectId") filter (where c.project_status = 'published') as projects_published,
       count(distinct m."projectId") filter (where c.kind = 'page') as page_projects,
       count(distinct m."projectId") filter (where c.kind <> 'page') as other_projects
from "projectChatMessages" m join classes c on c.project_id = m."projectId"
where c.class = 'customer' and m.tipo is null and m.transcript is not null and m."createdAt" >= :'since'::timestamp;

\echo
\echo '== 9. Coming back after a pause: the first provider call of a turn, by how long the conversation had been quiet =='
\echo '   quiet = since the conversation''s previous turn that called the model ended. A turn past the provider''s cache'
\echo '   pays its whole history again; the cold return (lib/agent/cold-return.ts) sends it trimmed. Turns a person typed.'
\set quiet 'calls as (select s."projectId" as project_id, s."turnId" as turn_id, s.step, s."startedAt" as started, s."startedAt" + make_interval(secs => s."durationMs" / 1000.0) as ended, coalesce(s."inputTokens", 0) as input, least(coalesce(s."cachedTokens", 0), coalesce(s."inputTokens", 0)) as cached from "agentRequestSteps" s where s."subagentId" is null and s."createdAt" >= current_setting(''len.since'')::timestamp), spans as (select project_id, turn_id, min(started) as started, max(ended) as ended from calls group by 1, 2), firsts as (select distinct on (turn_id) turn_id, input as first_input, cached as first_cached from calls order by turn_id, step), quiet as (select sp.started, f.first_input, f.first_cached, m.origen->>''kind'' as origin, m.centicredits, coalesce(m.transcript ? ''coldTrim'', false) as trimmed, lag(sp.ended) over (partition by sp.project_id, coalesce(m.conversation, '''') order by sp.started) as prev_ended from spans sp join firsts f using (turn_id) join "projectChatMessages" m on m.id = sp.turn_id)'
with :quiet
select case when prev_ended is null then '0 first turn of the conversation'
            when started - prev_ended < interval '5 minutes' then '1 under 5 min'
            when started - prev_ended < interval '30 minutes' then '2 5 to 30 min'
            when started - prev_ended < interval '65 minutes' then '3 30 to 65 min'
            when started - prev_ended < interval '6 hours' then '4 65 min to 6 h'
            when started - prev_ended < interval '24 hours' then '5 6 to 24 h'
            else '6 over a day' end as quiet_for,
       count(*) as turns,
       round(percentile_cont(0.5) within group (order by first_input)) as first_call_input_p50,
       max(first_input) as first_call_input_max,
       round(100.0 * sum(first_cached) / nullif(sum(first_input), 0), 1) as first_call_cached_pct,
       count(*) filter (where first_cached = 0) as fully_cold,
       count(*) filter (where trimmed) as sent_trimmed,
       round(percentile_cont(0.5) within group (order by centicredits)::numeric / 100, 2) as credits_p50,
       round(avg(centicredits)::numeric / 100, 2) as credits_mean
from quiet where origin is null group by 1 order by 1;

\echo '   the turns that sent their history trimmed, of any origin (a scheduled run comes back cold too)'
with :quiet
select count(*) as trimmed_turns,
       round(percentile_cont(0.5) within group (order by first_input)) as first_call_input_p50,
       round(percentile_cont(0.5) within group (order by first_input - first_cached)) as first_call_uncached_p50,
       round(percentile_cont(0.5) within group (order by centicredits)::numeric / 100, 2) as credits_p50
from quiet where trimmed;

rollback;
