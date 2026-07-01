"use client";

import { useEffect, useState } from "react";
import type { ModelFamily } from "@/lib/models/families";

// Shape returned by GET /api/models (stripInternals in the route).
export interface ModelItem {
  id: string;
  name: string;
  family: ModelFamily;
  author: string;
  pitch: string;
  description: string;
  storageUrl: string;
  contentHash: string;
  sceneSpec: Record<string, unknown> | null;
  tags: string[];
  license: string;
  thumbnailUrl: string | null;
  tileUrl: string | null;
  featured: boolean;
}

interface UseModelsResult {
  models: ModelItem[];
  loading: boolean;
  error: string | null;
}

// Module-level cache — re-mounting the panel doesn't trigger a new fetch.
// The /api/models response has a 5-min CDN s-maxage so the cost is low.
let cached: ModelItem[] | null = null;
let inflight: Promise<ModelItem[]> | null = null;

async function fetchModels(): Promise<ModelItem[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch("/api/models", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
    const json = (await res.json()) as { models: ModelItem[] };
    cached = json.models;
    return cached;
  })();
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<ModelItem[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((items) => {
        if (!cancelled) {
          setModels(items);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, error };
}
