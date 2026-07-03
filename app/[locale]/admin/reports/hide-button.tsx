"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HideButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function hide() {
    setBusy(true);
    await fetch(`/api/admin/projects/${projectId}/visibility`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "hidden" }),
    });
    router.refresh();
  }
  return (
    <button onClick={hide} disabled={busy}
      className="text-xs px-2 py-1 rounded-md bg-red-600 text-white disabled:opacity-50 shrink-0">
      {busy ? "…" : "Hide"}
    </button>
  );
}
