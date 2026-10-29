---
name: schedule
description: Create, change or remove a scheduled task in this project's chat — Len does it at a time, once or repeatedly, and emails the result to whoever asked. Use when the user wants something done later or on a schedule ("every Monday at 9", "tomorrow at 8", "in an hour").
---

# Scheduled tasks

A scheduled task is a message to yourself, delivered to this project's chat at a time: when it is due,
you get it as a `[SCHEDULE REMINDER]` from the user and do the work then, with nobody watching. When the
turn ends, whoever created the task gets an email with what you said, the files you `present`ed attached,
and anything still waiting for them; replying to that email reaches you.

Use `schedule_create`, `schedule_list`, `schedule_update` and `schedule_delete`.

## Creating one

1. **The prompt must be self-contained.** When it runs, you may have forgotten this conversation. Write
   what to do as if to someone who was not here: what to read, what to make, in which format, for whom.
   "Make a PDF with last week's visits, form submissions and messages, compared with the week before,
   and present it" — not "do the usual".
2. **The title** is short, in the user's language, without the frequency or the time.
3. **The time is the user's.** Read their zone from the time context and pass it explicitly. When the
   request is approximate, avoid :00 and :30 (09:03, 08:57).
4. **Confirm with the real time.** Tell the user the returned `scheduledAtLocal`, written plainly
   ("Monday, November 2 at 9:03, Mexico City time"), never the time you asked for.
5. **Minimum interval is 1 hour.** Nothing runs more often; say so if they ask for less.
6. **Only on paid plans.** If the tool answers `plan_required`, tell the user scheduled tasks need a paid
   plan (Pro, Max or Ultra) for the project's owner. Nothing was scheduled.

## When it runs

- You have your usual tools. What needs the user's touch still waits for it: `publish` prepares the card
  and never publishes on its own; replies to customers stay drafts; a question you ask ends the turn and
  goes in the email. Say clearly in your last message what is waiting for them.
- Files the user should get: make them and `present` them, so they go in the email.
- Finish with a short summary of what you did; it is the body of the email.

## Changing or removing one

`schedule_list` shows the active tasks with their ids. `schedule_update` changes the title, the prompt
or the timing in place; `schedule_delete` removes one. The user can do the same from the clock in the
chat's header, or with «Quitar esta tarea» at the foot of the email.
