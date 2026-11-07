// Every code the agent's `error` event can carry has its text in every locale: the panel shows
// `wsPage.agent.errors.<code>`, and a missing key shows the raw key. `agent_off` used to be the exception — the panel
// fell back to ai-design and never said it — until the person's own assistant, which never falls back, had to say it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_ERROR_CODE_KEYS } from "./use-agent-chat";

const LOCALES = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;

describe("the agent's error texts", () => {
  for (const locale of LOCALES) {
    it(`${locale}: every agent error code has its text`, () => {
      const ws = JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "wsPage.json"), "utf8")) as { agent: { errors: Record<string, string> } };
      const missing = Object.keys(AGENT_ERROR_CODE_KEYS).filter((code) => typeof ws.agent.errors[code] !== "string" || ws.agent.errors[code]!.trim() === "");
      expect(missing).toEqual([]);
    });
  }
});
