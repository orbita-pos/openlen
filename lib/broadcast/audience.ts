// Broadcast audience resolution — who a campaign actually goes to.
//
// v1 (user-approved): ACTIVE members only. Invited-but-never-logged-in rows
// are excluded (no consent yet — they never proved the address or accepted
// anything). Leads (formSubmissions) are phase 2, behind explicit opt-in —
// there is deliberately NO includeLeads flag here so the dead path can't be
// called. Suppressed (unsubscribed/bounced) emails are removed, and the list
// is deduped + normalized. Computed at SEND time so an unsubscribe between
// draft and send is honored.

import { listMembers } from "@/lib/members/store";
import { listSuppressedEmails } from "@/lib/broadcast/store";

export interface AudienceMember {
  memberId: string;
  email: string;
  name: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Pure core — active members only, minus suppressed, deduped + normalized.
 *  Extracted so the policy (the part that's easy to get wrong) is unit-tested
 *  without a DB. */
export function filterAudience(
  members: Array<{ id: string; email: string; name: string | null; status: string }>,
  suppressedEmails: string[],
): AudienceMember[] {
  const blocked = new Set(suppressedEmails.map(normalizeEmail));
  const seen = new Set<string>();
  const out: AudienceMember[] = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    const email = normalizeEmail(m.email);
    if (blocked.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ memberId: m.id, email, name: m.name });
  }
  return out;
}

export async function resolveBroadcastAudience(
  projectId: string,
): Promise<AudienceMember[]> {
  const [members, suppressed] = await Promise.all([
    listMembers(projectId),
    listSuppressedEmails(projectId),
  ]);
  return filterAudience(members, suppressed);
}

/** Count + a small name sample for the compose-screen "Send to N members"
 *  preview, without materializing the whole list to the client. */
export async function previewBroadcastAudience(
  projectId: string,
): Promise<{ audienceCount: number; sampleNames: string[] }> {
  const audience = await resolveBroadcastAudience(projectId);
  const sampleNames = audience
    .slice(0, 5)
    .map((m) => m.name || m.email);
  return { audienceCount: audience.length, sampleNames };
}
