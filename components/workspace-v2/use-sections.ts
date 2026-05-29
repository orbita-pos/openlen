"use client";

import { useEffect, useState } from "react";
import { apiItemToSpec, type SectionSpec } from "./sections-data";
import type { SectionType } from "@/lib/sections/types";

interface UseSectionsResult {
  sections: SectionSpec[];
  byType: (t: SectionType) => SectionSpec[];
  isLoading: boolean;
  error: string | null;
}

// Module-level cache so re-mounting the panel doesn't refetch (mirrors
// useTemplates). /api/sections is itself CDN-cached, so the cost is low.
let cached: SectionSpec[] | null = null;
let inflight: Promise<SectionSpec[]> | null = null;

async function fetchSections(): Promise<SectionSpec[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch("/api/sections", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      inflight = null;
      throw new Error(`sections fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      sections: Parameters<typeof apiItemToSpec>[0][];
    };
    const specs = json.sections.map(apiItemToSpec);
    cached = specs;
    inflight = null;
    return specs;
  })();
  return inflight;
}

export function useSections(): UseSectionsResult {
  const [sections, setSections] = useState<SectionSpec[]>(cached ?? []);
  const [isLoading, setIsLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSections()
      .then((specs) => {
        if (!cancelled) {
          setSections(specs);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    sections,
    byType: (t) => sections.filter((s) => s.type === t),
    isLoading,
    error,
  };
}
