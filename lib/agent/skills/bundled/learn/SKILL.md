---
name: learn
description: Turn corrections, preferences or hard-won fixes from this conversation into a concrete proposal to update or create a rule in /LEN.md or a reusable skill under /.len/skills/ or ~/.len/skills/, always asking the owner before editing.
---

# Learning from this conversation

Use this skill when the owner wants to save a recurring preference, correction or workflow so future turns follow it automatically.

## 1. Identify what is actually worth saving
- Scan the conversation for explicit corrections, constraints or overrides from the owner ("no", "instead", "always do X", "never Y") and for failures that took multiple steps to diagnose.
- Isolate the root rule or procedure, not a one-off typo or single-turn detail.
- If nothing reusable emerged, tell the owner plainly and stop without proposing edits.

## 2. Classify: Rule vs Skill
- **Rule** (`/LEN.md` for this project, or `~/.len/LEN.md` for every project): universal behavioral guardrails, tone/style invariants, naming conventions or hard constraints.
- **Skill** (`/.len/skills/<name>/SKILL.md` or `~/.len/skills/<name>/SKILL.md`): multi-step procedures, repeatable checklists, domain recipes or verification flows. Load `skill-creator` if you need the exact file format.

## 3. Update existing first, and watch file size
- Inspect existing `/LEN.md` and relevant skills before proposing a new file.
- Prefer updating an existing rule or skill that missed an edge case over adding a duplicate. If the file is already long, condense or split instead of appending blindly.

## 4. Propose before editing
- Do **not** edit `/LEN.md` or any skill file until the owner approves.
- Show the owner:
  1. Target path and whether it is an update or a new file.
  2. Why it belongs there (Rule vs Skill, project vs personal).
  3. The exact concise text or diff you plan to write.
- Wait for confirmation, then apply only what the owner approved: `/LEN.md` and a project skill (`/.len/skills/<name>/SKILL.md`) with `Write` or `Edit`.
- A skill of their own (`~/.len/skills/<name>/SKILL.md`) is the exception: the card is the proposal. Call `propose_skills` with it (for one of theirs, read it first and send your edits) instead of showing the text and waiting; they save it from the card.
