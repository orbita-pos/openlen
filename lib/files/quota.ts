// What a project takes on its «disk» (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §4): its pages,
// its folder —a binary by its pointer's size, never by downloading it— and git's history, as a disk counts
// `.git`. Deleting a file that older commits hold frees nothing, as in git.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

import { BLOB_PREFIX } from "./blob-pointer";

export async function projectUsageBytes(projectId: string): Promise<number> {
  const r = (await db.execute(sql`
    select
      coalesce((select octet_length(coalesce(p."data"->>'html', ''))
                  + coalesce((select sum(octet_length(coalesce(pg.value->>'html', '')))
                              from jsonb_each(case when jsonb_typeof(p."data"->'pages') = 'object' then p."data"->'pages' else '{}'::jsonb end) pg), 0)
                from "projects" p where p."id" = ${projectId}), 0)
      + coalesce((select sum(case when starts_with(f."content", ${BLOB_PREFIX})
                                  then split_part(f."content", ':', 3)::bigint
                                  else octet_length(f."content") end)
                  from "projectFiles" f where f."projectId" = ${projectId}), 0)
      + coalesce((select sum(octet_length(o."content")) from "projectGitObjects" o where o."projectId" = ${projectId}), 0)
      as "bytes"
  `)) as unknown as { rows?: { bytes: string | number }[] } | { bytes: string | number }[];
  const row = Array.isArray(r) ? r[0] : r.rows?.[0];
  return Number(row?.bytes ?? 0);
}
