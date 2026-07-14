"use client";

import { useEffect, useState } from "react";
import type { BehaviorsPreviewFlags } from "./use-behaviors-preview";

const DEFAULT_FLAGS: BehaviorsPreviewFlags = { behaviors: true, carousel: true };

/** Lee /api/flags una vez al montar el workspace. FAIL-OPEN a propósito: si
 *  el fetch falla o tarda, el preview inyecta con normalidad — que es
 *  exactamente lo que hace el servidor cuando el env no está puesto, así que
 *  el fallo transitorio nunca crea divergencia nueva. Solo un "0" explícito
 *  servido por el endpoint apaga una mitad — y entonces apaga las dos, porque
 *  publish lee el MISMO predicado (lib/publish/kill-switches.ts). */
export function useKillSwitches(): BehaviorsPreviewFlags {
  const [flags, setFlags] = useState<BehaviorsPreviewFlags>(DEFAULT_FLAGS);
  useEffect(() => {
    let alive = true;
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (!alive || !j || typeof j !== "object") return;
        const o = j as Record<string, unknown>;
        const behaviors = o.behaviors !== false;
        const carousel = o.carousel !== false;
        // Conservar la IDENTIDAD del objeto cuando nada cambió (el caso
        // normal: todo encendido) — un objeto nuevo con los mismos valores
        // re-dispararía el derive() del preview y recargaría el iframe al
        // arrancar, sin motivo.
        setFlags((prev) =>
          prev.behaviors === behaviors && prev.carousel === carousel ? prev : { behaviors, carousel },
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}
