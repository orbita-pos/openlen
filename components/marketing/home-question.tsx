"use client";

// THE HOME'S QUESTION (Jesús, 06/11): «¿Con qué empezamos?» instead of a slogan — OpenLen is an input, like Gemini's
// home — and different with the visitor's own time of day, the way claude.ai's greeting changes from morning to
// night. Several per slot and per locale (`marketing.hero.questions.<slot>`), one at random per visit
// (`lib/marketing/home-question.ts`). «Tu propio desarrollador web» lives on in the page's title and on len.openlen.com.
//
// The server can't know the visitor's clock, so it renders the neutral `hero.question` — what crawlers and no-JS
// visitors read (the hero adds a <noscript> that shows it) — invisible; in the browser the question of the hour
// replaces it and fades in, so the swap is never seen.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { pickQuestion, questionSlot } from "@/lib/marketing/home-question";
import { cn } from "@/lib/cn";

export function HomeQuestion({
  now = () => new Date(),
  random = Math.random,
  as: Heading = "h1",
}: {
  /** The visitor's clock and the dice — injectable for tests. */
  now?: () => Date;
  random?: () => number;
  /** The home's h1; /new's start screen (06/11, the same screen) already has its own h1, so there it is an h2. */
  as?: "h1" | "h2";
}) {
  const t = useTranslations("marketing");
  const [question, setQuestion] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const list = t.raw(`hero.questions.${questionSlot(now().getHours())}`);
    setQuestion(pickQuestion(Array.isArray(list) ? (list as string[]) : [], random()));
    setReady(true);
    // Once, on mount: the question doesn't change under the visitor's eyes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Heading
      className={cn(
        // 36 px on a desktop, Gemini's size (Jesús, 06/11); smaller on a phone.
        "home-question max-w-[48rem] text-balance text-[28px] font-medium leading-[1.15] tracking-[-0.025em] sm:text-[32px] md:text-[36px]",
        "transition-opacity duration-500 motion-reduce:transition-none",
        ready ? "opacity-100" : "opacity-0",
      )}
    >
      {question ?? t("hero.question")}
    </Heading>
  );
}
