"use client";

// QUIÉN HAY EN EL PROYECTO, para el chat del equipo: la gente que se puede
// mencionar (y su color, por su puesto: el dueño y luego los miembros), quién
// mira y si puede pedirle cosas a Len. Sale de GET /api/projects/[id]/miembros.

import { useEffect, useState } from "react";

import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

export interface GenteDelChat {
  readonly gente: readonly PersonaMencionable[];
  readonly yo: string | null;
  readonly puedeLen: boolean;
  readonly compartido: boolean;
}

type Persona = { userId: string; name: string | null; email: string };

export function genteDesdeMiembros(r: { rol: string; yo: string; dueno: Persona | null; miembros: Persona[] }): GenteDelChat {
  const todas = [...(r.dueno ? [r.dueno] : []), ...r.miembros];
  return {
    gente: todas.map((p) => ({ userId: p.userId, nombre: p.name?.trim() || p.email })),
    yo: r.yo,
    puedeLen: r.rol === "dueno" || r.rol === "editor",
    compartido: r.miembros.length > 0,
  };
}

const NADIE: GenteDelChat = { gente: [], yo: null, puedeLen: true, compartido: false };

export function useGenteDelChat(projectId: string): GenteDelChat {
  const [gente, setGente] = useState<GenteDelChat>(NADIE);
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
  }, [projectId]);
  return gente;
}
