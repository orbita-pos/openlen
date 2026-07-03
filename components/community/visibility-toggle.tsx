"use client";
import { useState } from "react";

export default function VisibilityToggle({
  projectId, initial, onNeedHandle,
}: { projectId: string; initial: "public" | "private" | "hidden"; onNeedHandle: (retry: () => void) => void }) {
  const [vis, setVis] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle() {
    if (vis === "hidden") return; // owner can't un-hide; admin-only
    const next = vis === "public" ? "private" : "public";
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/visibility`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (j?.needsHandle) { onNeedHandle(toggle); return; }
    if (res.ok) { setVis(next); return; }
    setMsg(
      j?.error === "not_published" ? "Publish the page first." :
      j?.error === "blocked" ? "Blocked by content filter." : "Couldn't update.",
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggle} disabled={busy || vis === "hidden"}
        className={`text-xs px-2 py-1 rounded-md border ${vis === "public" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-neutral-300 text-neutral-600"}`}>
        {vis === "public" ? "Public ✓" : vis === "hidden" ? "Hidden (admin)" : "Make public"}
      </button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
