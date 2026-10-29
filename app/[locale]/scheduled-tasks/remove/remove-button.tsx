"use client";
// The one control that removes a task from the email's link: a POST with the signed token.
import { useState } from "react";

export function RemoveTaskButton({ taskId, token, label, done }: { taskId: string; token: string; label: string; done: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  if (state === "done") return <p className="text-[15px] text-neutral-600">{done}</p>;
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        const res = await fetch("/api/scheduled-tasks/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: taskId, token }) }).catch(() => null);
        setState(res?.ok ? "done" : "error");
      }}
      className="rounded-lg bg-[#FF5A36] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-60"
    >
      {state === "error" ? `${label} ↻` : label}
    </button>
  );
}
