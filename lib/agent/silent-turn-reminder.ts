// Claude Code's `silent_turn_reminder` (binary 2.1.304, `AIr`/`OIr`): after `SILENT_STEPS` model steps
// in a row with nothing the person can see, the step ends with its text in a <system-reminder>; at most
// `MAX_REMINDERS_IN_STRETCH` times per silent stretch. What counts as speaking is theirs: visible text, or
// a tool that addresses the person (AskUserQuestion, ExitPlanMode… — in Len, `asksTheOwner`). Len
// speaking, or a message from the person (`reset`), starts the stretch over. Same numbers and text.

// Cache effect: none on the prefix: the reminder rides at the end of a step with the tool results and is saved with them.

export const SILENT_STEPS = 5;
export const MAX_REMINDERS_IN_STRETCH = 3;
export const SILENT_TURN_TEXT =
  "The user hasn't heard from you in a while. As you continue, keep them updated when there's something to tell — a finding, a change of plan.";

export function createSilentTurnReminder(): {
  /** One model step: did it say something the person sees? Returns the reminder, or "". */
  observe(spoke: boolean): string;
  /** A message from the person: a new stretch. */
  reset(): void;
} {
  let silentSteps = 0;
  let remindersInStretch = 0;
  return {
    observe(spoke) {
      if (spoke) {
        silentSteps = 0;
        remindersInStretch = 0;
        return "";
      }
      silentSteps += 1;
      if (silentSteps < SILENT_STEPS || remindersInStretch >= MAX_REMINDERS_IN_STRETCH) return "";
      silentSteps = 0;
      remindersInStretch += 1;
      return `<system-reminder>\n${SILENT_TURN_TEXT}\n</system-reminder>`;
    },
    reset() {
      silentSteps = 0;
      remindersInStretch = 0;
    },
  };
}
