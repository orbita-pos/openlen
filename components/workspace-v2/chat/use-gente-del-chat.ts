"use client";

// QUIÉN HAY EN EL PROYECTO, para el chat del equipo: la gente que se puede
// mencionar (y su color, por su puesto: el dueño y luego los miembros), quién
// mira y si puede pedirle cosas a Len. Sale de GET /api/projects/[id]/miembros.
//
// Se vuelve a leer cuando cambian los miembros: con el aviso del diálogo de
// miembros (`avisarMiembrosCambiaron`) y, mientras el dueño espera a alguien
// (una invitación sin aceptar), cada 30 s —el invitado acepta desde su correo
// con la pestaña del dueño abierta, y sin eso el chat no se enteraba de que el
// proyecto ya es compartido—. Sin invitaciones, no se pregunta solo.

import { useEffect, useState } from "react";

import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

export interface GenteDelChat {
  readonly gente: readonly PersonaMencionable[];
  readonly yo: string | null;
  readonly puedeLen: boolean;
  readonly compartido: boolean;
  /** El dueño invitó y nadie ha aceptado aún: alguien puede llegar. */
  readonly esperando: boolean;
}

/** El aviso de que los miembros cambiaron (invitar, quitar, cambiar el rol). */
export const MIEMBROS_CAMBIARON = "openlen:miembros-cambiaron";

export function avisarMiembrosCambiaron(): void {
  window.dispatchEvent(new Event(MIEMBROS_CAMBIARON));
}

const ESPERA_MS = 30_000;

type Persona = { userId: string; name: string | null; email: string };

export function genteDesdeMiembros(r: {
  rol: string;
  yo: string;
  dueno: Persona | null;
  miembros: Persona[];
  invitaciones?: readonly unknown[];
}): GenteDelChat {
  const todas = [...(r.dueno ? [r.dueno] : []), ...r.miembros];
  return {
    gente: todas.map((p) => ({ userId: p.userId, nombre: p.name?.trim() || p.email })),
    yo: r.yo,
    puedeLen: r.rol === "dueno" || r.rol === "editor",
    compartido: r.miembros.length > 0,
    esperando: (r.invitaciones?.length ?? 0) > 0,
  };
}

const NADIE: GenteDelChat = { gente: [], yo: null, puedeLen: true, compartido: false, esperando: false };

export function useGenteDelChat(projectId: string): GenteDelChat {
  const [gente, setGente] = useState<GenteDelChat>(NADIE);
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vivo = true;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/miembros`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j && typeof j.yo === "string") setGente(genteDesdeMiembros(j));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [projectId, vuelta]);
  useEffect(() => {
    const otraVez = () => setVuelta((n) => n + 1);
    window.addEventListener(MIEMBROS_CAMBIARON, otraVez);
    return () => window.removeEventListener(MIEMBROS_CAMBIARON, otraVez);
  }, []);
  useEffect(() => {
    if (!gente.esperando) return;
    const reloj = window.setInterval(() => setVuelta((n) => n + 1), ESPERA_MS);
    return () => window.clearInterval(reloj);
  }, [gente.esperando]);
  return gente;
}
