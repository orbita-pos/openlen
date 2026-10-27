---
name: skill-creator
description: Create or edit a skill of this project or of the person — when the user asks to save a way of working, a recurring process or procedure (how they quote, how they write their weekly promo), or says "make it a skill".
---

# Creating a skill

A skill is a set of instructions that loads only when a task needs it: the catalog shows its name and description every turn, and its body is read when the task matches. Use one for a procedure that applies to some requests (how to quote, how to answer a complaint, how to prepare the weekly promo). Rules that must apply to EVERY message go in `/LEN.md` (the project's) or `~/.len/LEN.md` (the person's), not in a skill.

## Where it goes

- `/.len/skills/<name>/SKILL.md` — the project's: shared with everyone who works on this project. The default.
- `~/.len/skills/<name>/SKILL.md` — the person's own: only for them, in every project. Use it when they say it is theirs ("my way", "for me").

Write it with `Write` (or `Edit` to change one). A user skill is only its SKILL.md: no scripts or other files next to it. `/.openlen/skills` holds OpenLen's own skills, read-only, and their names are reserved.

## What it looks like

```markdown
---
name: cotizar
description: How this bakery quotes cakes and delivery. Use it whenever the user asks for a price or a quote.
---

# Quoting

- A one-tier cake: 350.
- …
```

- `name`: lowercase words joined by "-", the same as its folder.
- `description`: one line saying what it does AND when to use it — it is all the catalog shows, so it decides whether the skill loads.
- Optional: `when_to_use: <more on when>`; `disable-model-invocation: true` so only the user can invoke it with `/<name>`; `user-invocable: false` to keep it out of the user's `/` menu.

Write the body as instructions to yourself: the facts and numbers the user gave, the steps in order, and a worked example when there are calculations. Never invent figures the user didn't give; ask them. No credentials in a skill.

## After writing it

It is in the catalog from the next message, and the user can invoke it with `/<name>`. Tell them its name and what it will be used for. If the same rules were in `/LEN.md`, take them out of there so they live in one place.
