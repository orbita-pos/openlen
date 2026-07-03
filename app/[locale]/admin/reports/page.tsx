import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listOpenReports } from "@/lib/community/store";
import HideButton from "./hide-button";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/en/login");
  const rows = await db.select({ role: schema.users.role })
    .from(schema.users).where(eq(schema.users.id, session.user.id)).limit(1);
  if (rows[0]?.role !== "admin") redirect("/en");

  const reports = await listOpenReports();
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-xl font-semibold mb-4">Open reports</h1>
      {reports.length === 0 ? (
        <p className="text-neutral-400">No open reports.</p>
      ) : (
        <ul className="divide-y">
          {reports.map((r) => (
            <li key={r.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-xs text-neutral-500">
                  {r.reason}{r.note ? ` — ${r.note}` : ""} · {new Date(r.createdAt).toLocaleString()}
                  {" · "}<a className="underline" href={r.deployUrl ?? "#"} target="_blank" rel="noreferrer">visit</a>
                  {" · "}<span>{r.visibility}</span>
                </p>
              </div>
              <HideButton projectId={r.projectId} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
