// WHAT ONE REQUEST LEARNED WHILE ITS TOOLS RAN (spec local 2026-11-24-servidor-de-google-calendar, §5.3). A tool that hears
// Google refuse the person's token says so here; the server, which still holds that request's answer, turns it into the
// 401 the MCP client expects — the way Claude Code's client reacts to one: refresh the token and retry the same call, or
// ask the person to sign in again.
import { AsyncLocalStorage } from "node:async_hooks";

interface RequestState {
  googleRefused: boolean;
}

const current = new AsyncLocalStorage<RequestState>();

/** Runs one request with its own state; `refused()` says whether a tool heard Google refuse the token. */
export async function withRequestState<T>(run: () => Promise<T>): Promise<{ value: T; refused: () => boolean }> {
  const state: RequestState = { googleRefused: false };
  const value = await current.run(state, run);
  return { value, refused: () => state.googleRefused };
}

/** Called by a tool when Google answers 401 for the person's token. Outside a request it does nothing. */
export function noteGoogleRefused(): void {
  const state = current.getStore();
  if (state) state.googleRefused = true;
}
