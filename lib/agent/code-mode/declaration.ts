// lib/agent/code-mode/declaration.ts — `run_code` tool schema and system guidance
// for Programmatic Tool Calling (PTC / Code Mode, inspired by DeepSeek Harness
// `code-mode` and Claude Code `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`).
//
// Cache effect: declared only in Len Odyssey (`mode === "dynamis"`), where it stays
// fixed across every step of the turn; normal Len's system prompt and declarations
// are untouched byte for byte.

import { ASK_USER_QUESTION, CONNECT_EMAIL_DOMAIN, REQUEST_SECRETS } from "@/lib/agent/ask-user-question";
import { CONNECT_SHOPIFY_STORE } from "@/lib/agent/connect-shopify-store";
import { ENTER_PLAN_MODE, EXIT_PLAN_MODE } from "@/lib/agent/plan-mode";
import { PUBLISH_ARTIFACT } from "@/lib/len-artifacts/tools";
import { RUN_CODE_TOOL } from "./enabled";

/** Tools that pause for human confirmation/input or switch turn posture must be
 *  called directly at the top level, never from inside a `run_code` script. */
export const INTERACTIVE_OR_CONTROL_TOOLS: ReadonlySet<string> = new Set([
  RUN_CODE_TOOL,
  "publish",
  PUBLISH_ARTIFACT,
  ASK_USER_QUESTION,
  REQUEST_SECRETS,
  CONNECT_EMAIL_DOMAIN,
  CONNECT_SHOPIFY_STORE,
  ENTER_PLAN_MODE,
  EXIT_PLAN_MODE,
  "structured_output",
]);

export const CODE_MODE_GUIDANCE =
  "When a step needs 2+ chained, looped, conditional, or filtered tool calls —reading several files and extracting only matching symbols or line ranges, applying coordinated Edits across modules, running bash checks and parsing their output— batch them in one `run_code` script (`await tools.<name>(args)`) instead of spending separate round-trips, and return only the distilled result. For a single Read/Edit/Write/bash call (especially a large Write that previews live on the canvas) or interactive tools (`ask_user_question`, `publish`, `request_secrets`, plan mode), call the tool directly.";

export const DECLARACION_RUN_CODE: Record<string, unknown> = {
  name: RUN_CODE_TOOL,
  description:
    "Executes an isolated async TypeScript/JavaScript program for Programmatic Tool Calling (Code Mode). "
    + "Every non-interactive tool declared in this session is available on `tools.<tool_name>(args)` (for example `await tools.Read({ file_path: \"/index.html\" })`, `await tools.Edit({ ... })`, `await tools.bash({ command: \"...\" })`, `await Promise.all([tools.Read(...), tools.Read(...)])`).\n"
    + "- Top-level `await` and `return` work directly. Each `await tools.<name>(args)` resolves to that tool's response object (`{ ok: boolean, tool_result?: string, text?: string, error?: string, ... }`).\n"
    + "- Use `run_code` to collapse multi-file inspection, search/filter pipelines, coordinated multi-file edits, or check-and-fix steps into a single model turn, filtering bulky intermediate text inside JS and returning only a compact summary.\n"
    + "- Do NOT wrap a single tool call in `run_code`: call `Read`, `Edit`, `Write`, or `bash` directly when one call suffices (direct `Write` streams live preview to the canvas). Interactive/turn-stopping tools (`ask_user_question`, `request_secrets`, `publish`, `enter_plan_mode`, `exit_plan_mode`) cannot be called inside `run_code`.\n"
    + "- Runs in a sandboxed QuickJS WebAssembly VM (no Node `fs`, network, or `process`; 32 MB memory cap; max 25 tool calls per `run_code`). `console.log` / `console.warn` / `console.error` are captured.",
  parameters: {
    type: "OBJECT",
    properties: {
      description: {
        type: "STRING",
        description: "Short 3-8 word summary of what this script does.",
      },
      code: {
        type: "STRING",
        description: "TypeScript or JavaScript async body using `await tools.<name>(args)` and `return`.",
      },
    },
    required: ["description", "code"],
  },
};
