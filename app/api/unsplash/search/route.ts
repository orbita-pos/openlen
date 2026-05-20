import { auth } from "@/auth";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/unsplash/search — server-side proxy to Unsplash's photo search.
//
// Kept server-side so the API key never reaches the browser. When no key is
// configured (UNSPLASH_ACCESS_KEY missing), the endpoint returns a small
// hand-curated stock set so first-run users see SOMETHING even before they
// wire their own key into .env.local.
//
// Query: ?q=<term>&page=<n>
// Response: { results: UnsplashPhoto[], total: number, demoMode: boolean }
//
// Per Unsplash guidelines, the urls we forward already point at their CDN
// (images.unsplash.com) so hotlinking is fine. Attribution (photographer
// name + profile URL with utm_source=openlen) travels with each result —
// the picker UI surfaces it next to each thumbnail.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  alt: string;
  /** Smallest URL useful for the grid (~200px wide). */
  thumb: string;
  /** Mid-size URL — what we apply to the slot (~1080px). */
  full: string;
  /** Photographer name. */
  author: string;
  /** Author profile URL on Unsplash, with our utm tag. */
  authorUrl: string;
  /** Photo page on Unsplash (for the "Powered by Unsplash" link cluster). */
  photoUrl: string;
  /** Unsplash-internal endpoint we must ping when a user "uses" the
   *  photo, per their API guidelines. Null for demo-mode photos. */
  downloadLocation: string | null;
}

interface UnsplashSearchResult {
  results: UnsplashPhoto[];
  total: number;
  demoMode: boolean;
}

const UTM = "?utm_source=openlen&utm_medium=referral";

// Curated demo set — works without an API key so the picker has *something*
// to show on first run. Real photos from Unsplash's CDN, hotlinked per
// their guidelines. Attribution included for each.
const DEMO_SET: UnsplashPhoto[] = [
  {
    id: "demo-1",
    width: 6000,
    height: 4000,
    alt: "Laptop on a wooden desk with a cup of coffee",
    thumb:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1600&q=80",
    author: "Andrew Neel",
    authorUrl: `https://unsplash.com/@andrewtneel${UTM}`,
    photoUrl: `https://unsplash.com/photos/turned-on-flat-screen-monitor-1-aA2Fadydcg${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-2",
    width: 5760,
    height: 3840,
    alt: "Person typing on a laptop with code on the screen",
    thumb:
      "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1600&q=80",
    author: "James Harrison",
    authorUrl: `https://unsplash.com/@jstrippa${UTM}`,
    photoUrl: `https://unsplash.com/photos/black-flat-screen-computer-monitor-vpOeXr5wmR4${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-3",
    width: 6000,
    height: 4000,
    alt: "Open laptop showing a website on a clean desk",
    thumb:
      "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=1600&q=80",
    author: "Carl Heyerdahl",
    authorUrl: `https://unsplash.com/@carlheyerdahl${UTM}`,
    photoUrl: `https://unsplash.com/photos/KE0nC8-58MQ${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-4",
    width: 5760,
    height: 3840,
    alt: "Software developer's workspace with multiple monitors",
    thumb:
      "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1600&q=80",
    author: "ThisisEngineering",
    authorUrl: `https://unsplash.com/@thisisengineering${UTM}`,
    photoUrl: `https://unsplash.com/photos/ZPeXrWxOjRQ${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-5",
    width: 5184,
    height: 3456,
    alt: "Abstract neon gradient background",
    thumb:
      "https://images.unsplash.com/photo-1614624532983-4ce03382d63d?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1614624532983-4ce03382d63d?w=1600&q=80",
    author: "Codioful",
    authorUrl: `https://unsplash.com/@codioful${UTM}`,
    photoUrl: `https://unsplash.com/photos/k04fmoSXxYE${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-6",
    width: 4500,
    height: 3000,
    alt: "Modern office with people collaborating",
    thumb:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80",
    author: "Annie Spratt",
    authorUrl: `https://unsplash.com/@anniespratt${UTM}`,
    photoUrl: `https://unsplash.com/photos/WeYamle9fDM${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-7",
    width: 5184,
    height: 3456,
    alt: "Mountain range at sunrise with mist",
    thumb:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80",
    author: "Ales Krivec",
    authorUrl: `https://unsplash.com/@aleskrivec${UTM}`,
    photoUrl: `https://unsplash.com/photos/4l6lwIPzwLA${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-8",
    width: 6000,
    height: 4000,
    alt: "Dark code on a screen with reflections",
    thumb:
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1600&q=80",
    author: "Florian Olivo",
    authorUrl: `https://unsplash.com/@florianolv${UTM}`,
    photoUrl: `https://unsplash.com/photos/4hbJ-eymZ1o${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-9",
    width: 4500,
    height: 3000,
    alt: "Person holding a smartphone showing app interface",
    thumb:
      "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1600&q=80",
    author: "Plann",
    authorUrl: `https://unsplash.com/@plannthat${UTM}`,
    photoUrl: `https://unsplash.com/photos/ne1g6V8sfOs${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-10",
    width: 5184,
    height: 3456,
    alt: "Minimalist white desk setup with notebook",
    thumb:
      "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=1600&q=80",
    author: "Christopher Gower",
    authorUrl: `https://unsplash.com/@cgower${UTM}`,
    photoUrl: `https://unsplash.com/photos/m_HRfLhgABo${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-11",
    width: 5472,
    height: 3648,
    alt: "Team brainstorming around a whiteboard",
    thumb:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=80",
    author: "Akson",
    authorUrl: `https://unsplash.com/@akson${UTM}`,
    photoUrl: `https://unsplash.com/photos/D5nh6mCV52A${UTM}`,
    downloadLocation: null,
  },
  {
    id: "demo-12",
    width: 4928,
    height: 3264,
    alt: "Server room with rack lights",
    thumb:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=300&q=80",
    full:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1600&q=80",
    author: "Taylor Vick",
    authorUrl: `https://unsplash.com/@tvick${UTM}`,
    photoUrl: `https://unsplash.com/photos/M5tzZtFCOfs${UTM}`,
    downloadLocation: null,
  },
];

interface RawUnsplashPhoto {
  id: string;
  width: number;
  height: number;
  alt_description: string | null;
  description: string | null;
  urls: {
    full?: string;
    regular?: string;
    small?: string;
    thumb?: string;
  };
  user: {
    name: string;
    username: string;
  };
  links: {
    html: string;
    download_location?: string;
  };
}

interface RawSearchResponse {
  results: RawUnsplashPhoto[];
  total: number;
  total_pages: number;
}

function normalize(p: RawUnsplashPhoto): UnsplashPhoto {
  return {
    id: p.id,
    width: p.width,
    height: p.height,
    alt: p.alt_description ?? p.description ?? "",
    thumb: p.urls.thumb ?? p.urls.small ?? p.urls.regular ?? "",
    full: p.urls.regular ?? p.urls.full ?? p.urls.small ?? "",
    author: p.user.name,
    authorUrl: `https://unsplash.com/@${p.user.username}${UTM}`,
    photoUrl: `${p.links.html}${UTM}`,
    downloadLocation: p.links.download_location ?? null,
  };
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(50, pageRaw) : 1;

  const apiKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!apiKey) {
    // Demo mode — filter the curated set by the query (loose match on alt text)
    // so the user sees relevant-ish results even without configuring a key.
    const q = query.toLowerCase();
    const filtered = q
      ? DEMO_SET.filter((p) => p.alt.toLowerCase().includes(q))
      : DEMO_SET;
    return json(
      {
        results: filtered.length > 0 ? filtered : DEMO_SET,
        total: filtered.length > 0 ? filtered.length : DEMO_SET.length,
        demoMode: true,
      } satisfies UnsplashSearchResult,
      200,
    );
  }

  if (!query) {
    return json(
      { results: [], total: 0, demoMode: false } satisfies UnsplashSearchResult,
      200,
    );
  }

  try {
    const upstreamUrl = new URL("https://api.unsplash.com/search/photos");
    upstreamUrl.searchParams.set("query", query);
    upstreamUrl.searchParams.set("page", String(page));
    upstreamUrl.searchParams.set("per_page", "24");
    upstreamUrl.searchParams.set("content_filter", "high");

    const upstream = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Client-ID ${apiKey}`,
        "Accept-Version": "v1",
      },
      // Edge-cache results for a few minutes — Unsplash search responses
      // are stable, and we'd rather hit cache than burn rate-limit budget.
      next: { revalidate: 180 },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return json(
        {
          error: "unsplash_upstream",
          message: `Unsplash returned ${upstream.status}: ${text.slice(0, 200)}`,
        },
        upstream.status,
      );
    }

    const data = (await upstream.json()) as RawSearchResponse;
    return json(
      {
        results: data.results.map(normalize),
        total: data.total,
        demoMode: false,
      } satisfies UnsplashSearchResult,
      200,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[unsplash/search] failed", err);
    return json(
      {
        error: "fetch_failed",
        message: err instanceof Error ? err.message : "Network error",
      },
      500,
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
