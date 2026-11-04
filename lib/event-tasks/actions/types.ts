// WHAT A CARD CAN DO (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): the judge picks one or two of the
// actions its source offers, never one it made up — DeepSeek's rules and channels. A card keeps each with its own state,
// so «Hazlo» can report what it did, what is still being sent and what the row's change met.

/** Work in the project (the page, the app, a screen): Len's framed turn, as before. */
export interface ProjectAction {
  readonly kind: "project";
  readonly text: string;
}

/** One row of the watched table, changed by the OWNER's «Aplicar» — never by Len. `before` is what the judge saw:
 *  the update compares against it, so a row that changed since is not touched. */
export interface DataChangeAction {
  readonly kind: "data_change";
  readonly table: string;
  readonly key: Readonly<Record<string, string>>;
  readonly set: Readonly<Record<string, string>>;
  readonly before: Readonly<Record<string, string | null>>;
}

/** A message to the person, through the source's channel, sent exactly as the card shows it. */
export interface ReplyAction {
  readonly kind: "reply";
  readonly channel: "email";
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export type CardAction = ProjectAction | DataChangeAction | ReplyAction;

export type ActionState = "pending" | "done" | "blocked" | "failed" | "sending";

export interface CardActionRecord {
  readonly action: CardAction;
  readonly state: ActionState;
  readonly attempts: number;
  /** A send waiting for its next try, ISO. */
  readonly nextAttemptAt: string | null;
  readonly error: string | null;
  /** What it did, in a line: «mesa 4 → 6», «enviado a luis@…». */
  readonly result: string | null;
}

/** The error of a send the owner withdrew («Retirar»): the card says «Retirado». */
export const WITHDRAWN = "retirado por el dueño";

/** At most this many actions on one card: the real case needs two, move and tell. */
export const MAX_ACTIONS = 2;

export const freshRecord = (action: CardAction): CardActionRecord => ({ action, state: "pending", attempts: 0, nextAttemptAt: null, error: null, result: null });

/** One line for readers of the old column and the notice's email: what the card proposes. */
export function actionsLine(actions: readonly CardAction[]): string {
  return actions
    .map((a) =>
      a.kind === "project"
        ? a.text
        : a.kind === "data_change"
          ? `${a.table}: ${Object.entries(a.set)
              .map(([col, v]) => `${col} ${a.before[col] ?? "∅"} → ${v}`)
              .join(", ")}`
          : `→ ${a.to}: ${a.subject}`,
    )
    .join(" · ");
}
