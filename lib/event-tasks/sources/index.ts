// The sources a task can name (spec local 2026-11-03-len-que-avisa, §7.2): a task names only a registered one.
import "server-only";

import type { EventSourceKind } from "../store";
import { appRowsSource } from "./app-rows";
import { formSubmissionsSource } from "./form-submissions";
import type { EventSource } from "./types";

const SOURCES: Record<EventSourceKind, EventSource<never, never>> = {
  app_rows: appRowsSource as unknown as EventSource<never, never>,
  form_submissions: formSubmissionsSource as unknown as EventSource<never, never>,
};

export function sourceOf(kind: EventSourceKind): EventSource<unknown, unknown> {
  return SOURCES[kind] as unknown as EventSource<unknown, unknown>;
}
