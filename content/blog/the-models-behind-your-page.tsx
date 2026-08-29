import { Eye, MessageSquare, PenLine, Sparkles } from "lucide-react";
import type { BlogPostMeta } from "@/lib/blog";

// ─────────────────────────────────────────────────────────────────────────────
// SUSTITUYE a `powered-by-gemini`, que era falso de arriba abajo desde el
// 2026-08-28: nombraba a Gemini 3.1 Pro como el motor de todo, vendía un
// selector de modelo que ya no existe, y decía «una llamada» cuando crear son
// varias. No se podía parchear porque hasta el slug mentía.
//
// LA REGLA QUE DEJA ESTE POST: aquí no se nombra un modelo que no se pueda
// comprobar en `lib/generation/model-policy.ts`. Un post de producto que
// nombra proveedores caduca solo, y caducado es una mentira pública.
// ─────────────────────────────────────────────────────────────────────────────

export const meta: BlogPostMeta = {
  slug: "the-models-behind-your-page",
  title: "The models behind your page",
  excerpt:
    "OpenLen doesn't run on one model. Four roles — a writer, a designer, a pair of eyes, and the agent — each on the model that is actually good at that job.",
  date: "2026-08-28",
  tag: "Release",
};

const ROLES = [
  {
    icon: PenLine,
    name: "The writer",
    body: "Writes your page from the brief, and rewrites it when you ask for a change. It works in edits, not in redrafts — when you ask to move one section, the other twelve come back byte-identical.",
  },
  {
    icon: Sparkles,
    name: "The designer",
    body: "Decides the section program before a line of HTML exists, and does the repair pass afterwards. This is the role that gets the most thinking budget, because layout is where a page is won or lost.",
  },
  {
    icon: Eye,
    name: "The eyes",
    body: "Renders your page in a real browser and looks at the screenshot. Not at the HTML — at the pixels. Contrast, overlap, an image that never loaded: things a model reading source code cannot see.",
  },
  {
    icon: MessageSquare,
    name: "The agent",
    body: "The one you talk to in Chat. It carries the whole session, edits the page, reads your business profile, searches photography — and then hands its work to the eyes before telling you it is done.",
  },
];

export function Body() {
  return (
    <div className="text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
      <p>
        Most AI page builders pick one model and route everything through it.
        That is the simplest thing to build, and it is the reason so many of
        them are good at exactly one part of the job.
      </p>
      <p className="mt-4">
        OpenLen splits the work into four roles and gives each one to the model
        that is actually good at it. You never choose between them — there is no
        model picker, because picking a model is our problem, not yours.
      </p>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Four roles
      </h2>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ROLES.map(({ icon: Icon, name, body }) => (
          <div
            key={name}
            className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-zinc-50/60 dark:bg-zinc-950 p-5"
          >
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-400 ring-1 ring-coral-200/60 dark:ring-coral-500/20">
              <Icon size={15} />
            </div>
            <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {name}
            </div>
            <p className="mt-1 text-sm">{body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Why the eyes matter most
      </h2>
      <p>
        A model that only reads HTML will tell you a page is fine when the
        headline is grey text on a grey gradient, because in the source those
        are two different values and both look reasonable. Only a screenshot
        shows you they are the same colour once painted.
      </p>
      <p className="mt-4">
        So the last thing that happens before a page reaches you is that
        something opens it in a browser and looks. That step is the difference
        between a page that reads well as code and a page that reads well as a
        page.
      </p>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Who your data reaches
      </h2>
      <p>
        Your brief text and your page HTML go to{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          Fireworks AI
        </span>
        , which runs every one of those four roles. If you edit an image with
        AI, that image and your instruction go to{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          OpenAI
        </span>
        . That is the complete list, and it is the same list on our{" "}
        <a
          href="/subprocessors"
          className="font-medium text-coral-600 dark:text-coral-400 underline underline-offset-2"
        >
          subprocessors page
        </a>{" "}
        — if one ever disagrees with the other, the subprocessors page is the
        one we keep true.
      </p>

      <p className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-6 font-medium text-zinc-900 dark:text-zinc-100">
        Four models, one page, no picker.
      </p>
    </div>
  );
}
