// What the mailbox between Len and the person's agents keeps, and for how long (spec local
// 2026-11-21-len-y-el-agente-conversan, decision 9).

/** How long a message nobody has read can wait, held or pending, before it expires. */
export const HELD_DAYS = 7;

/** How long a message that woke a turn is still resumed when the server starts; older, it is given up (as the threads are). */
export const RESUME_HOURS = 24;
