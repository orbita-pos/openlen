-- Read-only measurement: what Len's turns are charged in production, before and
-- after the prompt-cache fix (a4814c5e), which went live on 2026-10-11 22:38 UTC
-- with the dfd26ed1 deploy. Also: how much of each plan the accounts actually use,
-- and how the turns fall on DeepSeek's peak / off-peak hours.
--
-- The prompt-cache hit rate itself is NOT in the database: it is only in the
-- journal line app/api/agent/route.ts prints per turn. That one is
-- scripts/measure/len-cache-from-journal.sh.
--
-- SAFETY. A measurement SELECT without a timeout once ran for 17 h on this box
-- and left a deploy's ALTER (and the whole chat table behind it) queued. So:
--   * everything runs in ONE read-only transaction that is rolled back at the end;
--   * statement_timeout caps every query at 60 s;
--   * lock_timeout 1 s makes a query give up instead of queueing behind a DDL lock;
--   * no regex, and the big columns are never read (`transcript` is only tested
--     for NULL, which does not detoast it).
--
-- RUN IT ON THE BOX:
--   sudo -u postgres psql -d openlen -X -f /tmp/len-turn-credits.sql
-- To leave your own accounts out of every number (comma-separated, no spaces):
--   sudo -u postgres psql -d openlen -X -v exclude=me@example.com,other@example.com -f /tmp/len-turn-credits.sql
--
-- WHAT A ROW IS. `projectChatMessages` with `tipo IS NULL` (a turn with Len, not a
-- message between people) and `transcript IS NOT NULL` (written by /api/agent;
-- the old ai-design Chat leaves it NULL). `centicredits` is what the turn was
-- CHARGED (100 = 1 credit = $0.01 at Fireworks list price); it exists since
-- 2026-10-05, and capped / stopped / failed turns are charged less than they
-- cost, or 0. The turn's owner pays, so plans come from the project owner.
-- `createdAt` is a timestamp without time zone, written in the app's session
-- time zone: section 0 prints it, and the hour buckets assume UTC.

\set ON_ERROR_STOP on
\pset pager off
\pset null '-'
\if :{?exclude}
\else
  \set exclude ''
\endif
\set fix_at '2026-10-11 22:38:00'
\set before_from '2026-10-05 00:00:00'

set statement_timeout = '60s';
set lock_timeout = '1s';
set idle_in_transaction_session_timeout = '5min';
begin transaction isolation level repeatable read read only;

\echo
\echo '== 0. Which database is this, and its clock =='
select version() as server,
       current_database() as db,
       inet_server_addr() as addr,
       now() as now,
       (select setting from pg_settings where name = 'TimeZone') as server_tz,
       :'fix_at'::timestamp as fix_at,
       :'exclude' as excluded_accounts;

\echo
\echo '== 1. Len turns per period (credits = what the turn was charged) =='
with turns as (
  select m."createdAt" as at, m.centicredits as cc, m."durationMs" as ms,
         p."userId" as owner_id, u.plan,
         case when m."createdAt" >= :'fix_at'::timestamp then '2 after fix' else '1 before fix' end as period
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'before_from'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select period,
       count(*) as turns,
       count(*) filter (where cc is null) as no_cc,
       count(*) filter (where cc = 0) as charged_0,
       count(distinct owner_id) as accounts,
       min(at)::date as first_day,
       max(at)::date as last_day,
       round(avg(cc) / 100.0, 2) as avg_cr,
       round((percentile_cont(0.50) within group (order by cc))::numeric / 100, 2) as p50_cr,
       round((percentile_cont(0.75) within group (order by cc))::numeric / 100, 2) as p75_cr,
       round((percentile_cont(0.90) within group (order by cc))::numeric / 100, 2) as p90_cr,
       round((percentile_cont(0.99) within group (order by cc))::numeric / 100, 2) as p99_cr,
       round(max(cc) / 100.0, 2) as max_cr,
       round(sum(cc) / 100.0, 1) as total_cr,
       round(sum(cc) / 10000.0, 2) as total_usd_list,
       round((percentile_cont(0.50) within group (order by ms))::numeric / 1000, 0) as p50_secs,
       round((percentile_cont(0.90) within group (order by ms))::numeric / 1000, 0) as p90_secs
from turns
group by period
order by period;

\echo
\echo '== 2. Credits per turn, distribution =='
with turns as (
  select m.centicredits as cc,
         case when m."createdAt" >= :'fix_at'::timestamp then '2 after fix' else '1 before fix' end as period
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'before_from'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select case
         when cc is null then '0 no data'
         when cc = 0 then '1 = 0'
         when cc <= 50 then '2 <= 0.5'
         when cc <= 100 then '3 <= 1'
         when cc <= 200 then '4 <= 2'
         when cc <= 400 then '5 <= 4'
         when cc <= 800 then '6 <= 8'
         when cc <= 1600 then '7 <= 16'
         when cc < 2850 then '8 < 28.5'
         else '9 >= 28.5 (paid cap is 30)'
       end as credits_per_turn,
       count(*) filter (where period = '1 before fix') as before_fix,
       count(*) filter (where period = '2 after fix') as after_fix
from turns
group by 1
order by 1;

\echo
\echo '== 3. After the fix, by the owner plan (plan as it is TODAY) =='
with turns as (
  select m.centicredits as cc, p."userId" as owner_id, u.plan
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'fix_at'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select plan,
       count(*) as turns,
       count(distinct owner_id) as accounts,
       round(avg(cc) / 100.0, 2) as avg_cr,
       round((percentile_cont(0.50) within group (order by cc))::numeric / 100, 2) as p50_cr,
       round((percentile_cont(0.90) within group (order by cc))::numeric / 100, 2) as p90_cr,
       round(sum(cc) / 100.0, 1) as total_cr,
       -- At (or within 5 % of) the per-turn cap: 10 credits free, 30 paid.
       count(*) filter (where cc >= case when plan = 'free' then 950 else 2850 end) as at_turn_cap
from turns
group by plan
order by plan;

\echo
\echo '== 4. After the fix, per day =='
with turns as (
  select m."createdAt" as at, m.centicredits as cc, p."userId" as owner_id
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'fix_at'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select at::date as day,
       count(*) as turns,
       count(distinct owner_id) as accounts,
       round(sum(cc) / 100.0, 1) as credits
from turns
group by 1
order by 1;

\echo
\echo '== 5. After the fix, on DeepSeek peak hours (01-04 and 06-10 UTC, Mon-Fri) =='
with turns as (
  select m."createdAt" as at, m.centicredits as cc
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'fix_at'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select case
         when extract(isodow from at) between 1 and 5
          and extract(hour from at) in (1, 2, 3, 6, 7, 8, 9) then 'peak'
         else 'off-peak'
       end as deepseek_band,
       count(*) as turns,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_turns,
       round(sum(cc) / 100.0, 1) as credits,
       round(100.0 * sum(cc) / nullif(sum(sum(cc)) over (), 0), 1) as pct_credits
from turns
group by 1
order by 1;

\echo
\echo '== 6. After the fix, by hour (UTC, and Mexico City = UTC-6) =='
with turns as (
  select m."createdAt" as at, m.centicredits as cc
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'fix_at'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
)
select extract(hour from at)::int as hour_utc,
       ((extract(hour from at)::int + 18) % 24) as hour_cdmx,
       count(*) as turns,
       round(sum(cc) / 100.0, 1) as credits
from turns
group by 1, 2
order by 1;

\echo
\echo '== 7. After the fix, the 25 accounts that spent most on Len (projected to 30 days) =='
with turns as (
  select m.centicredits as cc, p."userId" as owner_id, u.plan
  from "projectChatMessages" m
  join projects p on p.id = m."projectId"
  join users u on u.id = p."userId"
  where m.tipo is null
    and m.transcript is not null
    and m."createdAt" >= :'fix_at'::timestamp
    and u.email <> all (string_to_array(:'exclude', ','))
),
per_account as (
  select owner_id, plan, count(*) as turns, coalesce(sum(cc), 0) as cc
  from turns
  group by owner_id, plan
),
span as (
  select greatest(extract(epoch from (now()::timestamp - :'fix_at'::timestamp)) / 86400, 1) as days
)
select left(split_part(u.email, '@', 1), 3) || '...@' || split_part(u.email, '@', 2) as account,
       a.plan,
       a.turns,
       round(a.cc / 100.0, 1) as cr_since_fix,
       round(a.cc / 100.0 / s.days * 30, 0) as cr_per_30d,
       x.allot / 100 as plan_cr,
       round(100.0 * a.cc / s.days * 30 / x.allot, 1) as pct_of_plan_per_30d,
       round(u.credits / 100.0, 1) as balance_cr,
       u."creditsRefreshedAt"::date as period_start
from per_account a
join users u on u.id = a.owner_id
cross join span s
cross join lateral (
  select case a.plan when 'pro' then 30000 when 'max' then 80000 when 'ultra' then 500000 else 2000 end as allot
) x
order by a.cc desc
limit 25;

\echo
\echo '== 8. Share of the plan used in the CURRENT 30-day period (every surface, from the balance) =='
\echo '   Only accounts whose period started in the last 30 days. Balances above the plan were topped up by hand and are left out of the percentages.'
with acc as (
  select u.plan, u.credits as bal,
         case u.plan when 'pro' then 30000 when 'max' then 80000 when 'ultra' then 500000 else 2000 end as allot
  from users u
  where u."creditsRefreshedAt" > now() - interval '30 days'
    and u.email <> all (string_to_array(:'exclude', ','))
),
used as (
  select plan, bal, allot, 100.0 * (allot - bal) / allot as pct
  from acc
  where bal <= allot
)
select a.plan,
       count(*) as accounts,
       count(*) filter (where a.bal > a.allot) as topped_up_by_hand,
       (select count(*) from used u where u.plan = a.plan and u.pct > 0) as used_some,
       (select round(avg(pct), 1) from used u where u.plan = a.plan) as avg_pct_used,
       (select round((percentile_cont(0.50) within group (order by pct))::numeric, 1) from used u where u.plan = a.plan) as p50_pct,
       (select round((percentile_cont(0.90) within group (order by pct))::numeric, 1) from used u where u.plan = a.plan) as p90_pct,
       (select count(*) from used u where u.plan = a.plan and u.pct >= 90) as used_90pct_or_more
from acc a
group by a.plan
order by a.plan;

\echo
\echo '== 9. After the fix, turns of the old ai-design Chat (no transcript) =='
select count(*) as turns,
       round(coalesce(sum(m.centicredits), 0) / 100.0, 1) as credits
from "projectChatMessages" m
join projects p on p.id = m."projectId"
join users u on u.id = p."userId"
where m.tipo is null
  and m.transcript is null
  and m."createdAt" >= :'fix_at'::timestamp
  and u.email <> all (string_to_array(:'exclude', ','));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. FROM THE SPEND LEDGER (creditLedger, spec local 2026-10-16-credit-ledger).
-- Only rows written since the ledger was deployed; empty before that. Same
-- safety as above. How a row reads:
--   * charged = `centicredits` (what left the balance; negative = returned);
--   * worth   = `listCenticredits`, what the work was worth at the billing rate
--               before caps (the app AI's reservation rows are left out: the
--               settlement row carries the real amount);
--   * cost    = `costMicroUsd`, what OpenLen really paid (NULL = unknown);
--   * given away = worth − charged: caps, stops, failed turns, and everything
--               OpenLen pays without charging (security review, a visitor's chat,
--               publish translations). The app AI's reserve/settle pair is left
--               out: it nets to what was charged;
--   * margin  = charged − cost, over the rows whose cost is KNOWN (plus the app
--               AI reservations, whose cost rides on their settlement row).
-- ─────────────────────────────────────────────────────────────────────────────

\echo
\echo '== 10a. From the ledger, by plan (of the moment) and surface =='
select l.plan,
       l.surface,
       count(*) as rows,
       count(l."costMicroUsd") as cost_known,
       round(sum(l.centicredits) / 100.0, 1) as charged_cr,
       round(coalesce(sum(l."listCenticredits") filter (where l.outcome <> 'reserve'), 0) / 100.0, 1) as worth_cr,
       round(coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as cost_usd,
       round(coalesce(sum(l."listCenticredits" - l.centicredits) filter (where l.outcome not in ('reserve', 'settle')), 0) / 100.0, 1) as given_away_cr,
       round(coalesce(sum(l.centicredits) filter (where l."costMicroUsd" is not null or l.outcome = 'reserve'), 0) / 10000.0 - coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as margin_usd
from "creditLedger" l
join users u on u.id = l."userId"
where u.email <> all (string_to_array(:'exclude', ','))
group by l.plan, l.surface
order by l.plan, l.surface;

\echo
\echo '== 10b. From the ledger, the whole thing =='
select count(*) as rows,
       min(l."createdAt")::date as first_day,
       max(l."createdAt")::date as last_day,
       round(sum(l.centicredits) / 100.0, 1) as charged_cr,
       round(coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as cost_usd,
       round(coalesce(sum(l.centicredits) filter (where l."costMicroUsd" is not null or l.outcome = 'reserve'), 0) / 10000.0 - coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as margin_usd
from "creditLedger" l
join users u on u.id = l."userId"
where u.email <> all (string_to_array(:'exclude', ','));

\echo
\echo '== 10c. From the ledger, the 25 accounts with the worst margin =='
select left(split_part(u.email, '@', 1), 3) || '...@' || split_part(u.email, '@', 2) as account,
       u.plan as plan_today,
       count(*) as rows,
       round(sum(l.centicredits) / 100.0, 1) as charged_cr,
       round(coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as cost_usd,
       round(coalesce(sum(l.centicredits) filter (where l."costMicroUsd" is not null or l.outcome = 'reserve'), 0) / 10000.0 - coalesce(sum(l."costMicroUsd"), 0) / 1e6, 4) as margin_usd
from "creditLedger" l
join users u on u.id = l."userId"
where u.email <> all (string_to_array(:'exclude', ','))
group by u.id, u.email, u.plan
order by margin_usd asc
limit 25;

rollback;
