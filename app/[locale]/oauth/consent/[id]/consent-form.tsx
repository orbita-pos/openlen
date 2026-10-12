"use client";
// Permisos, proyecto y los dos botones. POST con la cookie de la web; la
// respuesta trae a dónde volver (el cliente, con su código o el error).
import { useState } from "react";
import { useTranslations } from "next-intl";

export function ConsentForm({ id, asked, projects }: { id: string; asked: string[]; projects: { id: string; title: string }[] }) {
  const t = useTranslations("projects.mcpConsent");
  const [scopes, setScopes] = useState<string[]>(asked);
  const [projectId, setProjectId] = useState<string>("");
  const [state, setState] = useState<"idle" | "busy" | "redirecting" | "failed">("idle");
  const toggle = (s: string) => setScopes((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const decide = async (decision: "allow" | "deny") => {
    setState("busy");
    const res = await fetch(`/api/oauth/consent/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, scopes, project_id: projectId || null }),
    }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { redirect?: string }) : null;
    if (!body?.redirect) return setState("failed");
    setState("redirecting");
    window.location.href = body.redirect;
  };
  if (state === "redirecting") return <p className="text-base">{t("redirecting")}</p>;
  if (state === "failed") return <p className="text-base">{t("failed")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("scopesTitle")}</legend>
        <label className="flex items-center gap-2 opacity-70">
          <input type="checkbox" checked disabled /> {t("scopeRead")}
        </label>
        {asked.includes("projects:write") ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={scopes.includes("projects:write")} onChange={() => toggle("projects:write")} /> {t("scopeWrite")}
          </label>
        ) : null}
        {asked.includes("publish") ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={scopes.includes("publish")} onChange={() => toggle("publish")} /> {t("scopePublish")}
          </label>
        ) : null}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t("projectsTitle")}</span>
        <select className="rounded-lg border bg-transparent px-3 py-2 dark:[color-scheme:dark]" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t("allProjects")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {t("oneProject")}: {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={state === "busy"}
          onClick={() => decide("allow")}
          className="rounded-full bg-black px-5 py-2.5 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {t("allow")}
        </button>
        <button type="button" disabled={state === "busy"} onClick={() => decide("deny")} className="rounded-full border px-5 py-2.5 font-semibold disabled:opacity-50">
          {t("deny")}
        </button>
      </div>
    </div>
  );
}
