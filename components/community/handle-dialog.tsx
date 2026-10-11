"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function HandleDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: (h: string) => void }) {
  const t = useTranslations("explore.profile");
  const [handle, setHandle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  async function save() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/me/handle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && j?.handle) { onSaved(j.handle); onClose(); }
    else setErr(j?.error === "taken" ? t("handleTaken") :
               j?.error === "reserved" ? t("handleReserved") :
               t("handleInvalid"));
  }

  // La tarjeta lleva su color de texto: en las páginas oscuras (el perfil, /me)
  // heredaba el claro y quedaba blanco sobre blanco.
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onClick={onClose}>
      <div className="bg-white text-neutral-900 rounded-xl p-5 w-[22rem]" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-1">{t("handleTitle")}</h2>
        <p className="text-sm text-neutral-500 mb-3">{t("handleHint")}</p>
        <div className="flex items-center border rounded-lg px-2">
          <span className="text-neutral-400">@</span>
          <input autoFocus value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="flex-1 px-1 py-2 outline-none" placeholder={t("handlePlaceholder")} />
        </div>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md">{t("cancel")}</button>
          <button onClick={save} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-black text-white disabled:opacity-50">
            {busy ? "…" : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
