-- Read-only measurement: WHAT A SAVED CONVERSATION IS MADE OF (spec local
-- 2026-11-13-conversar-todo-el-mes, §1.3). When a turn starts after the provider's
-- cache expired, the whole conversation is paid again at the full input price; this
-- says which part of it weighs — what Len thought in turns before the last, the
-- arguments of old calls, old tool results — and how much the cold return's rule
-- (lib/agent/cold-return.ts: keep the 12 most recent results) would empty. It is the
-- forecast that sized the cold return, kept so it can be taken again.
--
-- SAFETY — the rules of len-production-baseline.sql:
--   * ONE read-only transaction, rolled back at the end;
--   * statement_timeout 60 s, lock_timeout 1 s;
--   * NO TEXT LEAVES THE BOX: sizes, counts and percentages only. Conversations are
--     numbered by size; no id, message, address or account is printed.
--
-- RUN IT ON THE BOX (copy the file to /tmp first):
--   sudo -u postgres psql -d openlen -X -f /tmp/len-conversation-composition.sql
-- From this machine, without copying anything:
--   ssh openlen "sudo -n -u postgres psql -d openlen -X" < scripts/measure/len-conversation-composition.sql
-- Parameter: -v since='2026-10-01'   first day counted
--
-- WHAT IS COUNTED. A conversation = the turn rows of one project and one
-- `conversation` (Len's chat, or one own assistant's). Sizes are characters of what
-- the row's transcript saved, as thousands of tokens at 3.5 characters each
-- (`CHARS_PER_TOKEN`). The owner's own words are not in a transcript, so `text` is
-- what Len said. `old` = in a turn before the conversation's last one.

\set ON_ERROR_STOP on
\pset pager off
\pset null '-'
\if :{?since}
\else
  \set since '2026-10-01'
\endif

set statement_timeout = '60s';
set lock_timeout = '1s';
set idle_in_transaction_session_timeout = '5min';
begin transaction isolation level repeatable read read only;

\echo
\echo '== 1. The largest conversations (thousands of tokens). clearable = tool results older than the 12 most recent, skills and already-emptied ones apart =='
with msgs as (
  select m."projectId" as p, coalesce(m.conversation, '') as c, m."createdAt" as at, m.id as row_id, e.ord as mi, e.msg
  from "projectChatMessages" m, jsonb_array_elements(m.transcript->'mensajes') with ordinality as e(msg, ord)
  where m.tipo is null and m.transcript is not null and jsonb_typeof(m.transcript->'mensajes') = 'array'
    and m."createdAt" >= :'since'::timestamp
),
results as (
  select p, c, at, mi, r.ord as ri, r.fr->>'name' as name,
         case when jsonb_typeof(r.fr->'response'->'tool_result') = 'string' then length(r.fr->'response'->>'tool_result')
              else length((r.fr->'response')::text) end as chars,
         coalesce((r.fr->'response'->>'tool_result') = '[Earlier tool result removed to save space]', false) as emptied
  from msgs, jsonb_array_elements(case when jsonb_typeof(msg->'functionResponses') = 'array' then msg->'functionResponses' else '[]'::jsonb end) with ordinality as r(fr, ord)
),
ranked as (
  select *, row_number() over (partition by p, c order by at desc, mi desc, ri desc) as recency
  from results where name <> 'skill' and not emptied
),
per_conv_results as (
  select p, c, count(*) as n_results, sum(chars) as result_chars,
         coalesce(sum(chars) filter (where recency > 12), 0) as clearable_chars,
         count(*) filter (where recency > 12) as clearable_n
  from ranked group by 1, 2
),
per_conv_msgs as (
  select p, c, count(distinct row_id) as turns,
         sum(length(coalesce(msg->>'content', ''))) as content_chars,
         sum(length(coalesce(msg->>'reasoning', ''))) as reasoning_chars,
         sum(length(coalesce((msg->'functionCalls')::text, ''))) as call_chars
  from msgs group by 1, 2
),
sized as (
  select turns, coalesce(n_results, 0) as n_results,
         (content_chars + reasoning_chars + call_chars + coalesce(result_chars, 0)) as total_chars,
         coalesce(result_chars, 0) as result_chars, coalesce(clearable_chars, 0) as clearable_chars,
         coalesce(clearable_n, 0) as clearable_n, reasoning_chars, call_chars, content_chars
  from per_conv_msgs left join per_conv_results using (p, c)
)
select row_number() over (order by total_chars desc) as conv, turns, n_results,
       round(total_chars / 3.5 / 1000.0) as total_ktok,
       round(result_chars / 3.5 / 1000.0) as results_ktok,
       round(clearable_chars / 3.5 / 1000.0) as clearable_ktok, clearable_n,
       round(100.0 * clearable_chars / nullif(total_chars, 0)) as clearable_pct,
       round(clearable_chars / 3.5) >= 20000 as clears,
       round(call_chars / 3.5 / 1000.0) as calls_ktok,
       round(reasoning_chars / 3.5 / 1000.0) as reasoning_ktok,
       round(content_chars / 3.5 / 1000.0) as text_ktok
from sized order by total_chars desc limit 25;

\echo
\echo '== 2. Conversations of 2+ turns and 100.000+ characters: the share that is OLD (turns before the last) =='
with msgs as (
  select m."projectId" as p, coalesce(m.conversation, '') as c, m.id as row_id,
         dense_rank() over (partition by m."projectId", coalesce(m.conversation, '') order by m."createdAt" desc, m.id desc) as turn_recency,
         e.msg
  from "projectChatMessages" m, jsonb_array_elements(m.transcript->'mensajes') as e(msg)
  where m.tipo is null and m.transcript is not null and jsonb_typeof(m.transcript->'mensajes') = 'array'
    and m."createdAt" >= :'since'::timestamp
),
conv as (
  select p, c, count(distinct row_id) as turns,
         sum(length(coalesce(msg->>'content', '')) + length(coalesce(msg->>'reasoning', '')) + length(coalesce((msg->'functionCalls')::text, '')) + length(coalesce((msg->'functionResponses')::text, ''))) as total_chars,
         coalesce(sum(length(coalesce(msg->>'reasoning', ''))) filter (where turn_recency > 1), 0) as old_reasoning_chars,
         coalesce(sum(length(coalesce((msg->'functionCalls')::text, ''))) filter (where turn_recency > 1), 0) as old_call_chars,
         coalesce(sum(length(coalesce((msg->'functionResponses')::text, ''))) filter (where turn_recency > 1), 0) as old_result_chars
  from msgs group by 1, 2
)
select count(*) as conversations,
       round(sum(total_chars) / 3.5 / 1000.0) as total_ktok,
       round(100.0 * sum(old_reasoning_chars) / nullif(sum(total_chars), 0)) as old_reasoning_pct,
       round(100.0 * sum(old_call_chars) / nullif(sum(total_chars), 0)) as old_calls_pct,
       round(100.0 * sum(old_result_chars) / nullif(sum(total_chars), 0)) as old_results_pct,
       round(percentile_cont(0.5) within group (order by 100.0 * old_reasoning_chars / nullif(total_chars, 0))) as old_reasoning_pct_p50,
       round(min(100.0 * old_reasoning_chars / nullif(total_chars, 0))) as old_reasoning_pct_min,
       round(max(100.0 * old_reasoning_chars / nullif(total_chars, 0))) as old_reasoning_pct_max
from conv where turns >= 2 and total_chars >= 100000;

rollback;
