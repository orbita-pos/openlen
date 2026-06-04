"use client";

import { useEffect, useState } from "react";
import { apiItemToSpec, type TemplateSpec } from "./templates-data";
import type {
  TemplateFamily,
} from "@/lib/templates/families";

interface UseTemplatesResult {
  templates: TemplateSpec[];
  byFamily: (f: TemplateFamily) => TemplateSpec[];
  isLoading: boolean;
  error: string | null;
}

// Module-level cache so re-mounting the panel doesn't refetch. Kept in
// memory; on a hard refresh we'll go to the server again. The /api/templates
// response is itself cache-controlled (5min CDN), so the cost is low.
let cached: TemplateSpec[] | null = null;
let inflight: Promise<TemplateSpec[]> | null = null;

async function fetchTemplates(): Promise<TemplateSpec[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch("/api/templates", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`templates fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      templates: Parameters<typeof apiItemToSpec>[0][];
    };
    const specs = json.templates.map(apiItemToSpec);
    cached = specs;
    return specs;
  })();
  // Clear the in-flight slot on ANY failure (rejected fetch, malformed body)
  // so a later mount retries instead of replaying the rejected promise forever.
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

export function useTemplates(): UseTemplatesResult {
  const [templates, setTemplates] = useState<TemplateSpec[]>(cached ?? []);
  const [isLoading, setIsLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTemplates()
      .then((specs) => {
        if (!cancelled) {
          setTemplates(specs);
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
    templates,
    byFamily: (f) => templates.filter((t) => t.family === f),
    isLoading,
    error,
  };
}
