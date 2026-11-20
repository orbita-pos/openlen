---
name: agent-creation
description: Create or change one of the person's own agents (a language teacher, a coach, a helper for anything): write its file in ~/.len/agents/, choose the job skill it carries, and hand them the card that creates it.
---

# Creating the person's own agents

An agent here is two things:
- **Its file**, `~/.len/agents/<name>.md`, which you write: what it is for, how it talks, the skill it carries and what it says first.
- **Its face**: the name the person calls it, its figure, color and tone. The person picks those in the creator that your `create_assistant` card opens, never in the file.

It lives in the person's space, talks with them in its own place and keeps its own memory. It has your tools except the ones that build, so never list tools in its file.

## 1. Ask only what is missing
- Never ask for its name: the person gives it one in the creator.
- Most requests need no questions ("I want an English teacher", "a running coach"). Ask one short round, with `ask_user_question`, only when the job itself is unclear ("an agent for my things").
- What the agent needs to learn about the person (their level, goals, schedule) is its job, not yours: it asks on its first turn.

## 2. Choose the job skill
- Teaching any language → `language-teacher`.
- Any other job, for now: no job skill. Put the know-how in the file's body: what it knows, how it works with the person, what it keeps track of and what it never does. A helper for money, health or legal matters says it is not a professional and tells the person when they need one.

## 3. Write the file
Write `~/.len/agents/<name>.md` with `Write`, in Claude Code's agent format. Each frontmatter key on one line:

```markdown
---
name: english-teacher
description: Teaches the person English by making them practise, at their level, with a plan and flashcards.
skills: language-teacher
initialPrompt: Greet the person in one line and start the placement interview from your language-teacher skill.
---

You are the person's English teacher. ...
```

- `name`: lowercase words joined by `-` (64 characters at most), the same as the file name. Take it from the job, not from what the person will call it: `english-teacher`, `running-coach`, `family-recipes`. Look in `~/.len/agents/` first: if that name is taken by another agent, add `-2`.
- `description`: one line on what it is for.
- `skills`: the job skill, or leave the key out when there is none.
- `initialPrompt`: one line, sent as the person's first message to the agent the first time they open it. Write it as an instruction to the agent ("Greet the person in one line and ask what they want to cook this week").
- No other keys. Never `tools` or `disallowedTools`.

The body talks to the agent in the second person and never names it (its name comes from its face). Say:
- **Who it is and what it is for.**
- **How it talks.** This is what makes it an agent and not a search box. A teacher or a coach does not hand over the answer first: it lets the person try, gives a hint, and only then shows the answer with a one-line reason. Short turns, one thing at a time, in the person's language.
- **What it keeps.** What it must always know about the person (language, level, goal) goes in its memory. What grows (a plan, flashcards, a recipe book, a training log) goes in files of the space, in a folder of its own (`/english/plan.md`).
- **What it never does.**

Never put credentials or the person's private data in the file.

## 4. Hand them the card
Call `create_assistant` with `agent: "<name>"` and a suggested look that fits the job. The person names it and adjusts its figure in the creator, which creates it and takes them to its place. Then say in one line what you made and that the card creates it. Don't paste the file.

Created from the space, the agent serves no page. Asked for inside a project, it still lives in the space and also serves that page: the card does both.

## 5. Changing an agent later
When the person asks to change one of their agents ("make it stricter", "teach me French too"):
- Read its file, then write it whole again with `Write`, keeping its `name`. It takes the new file on its next turn: no new card.
- Its name, figure and the pages it serves are changed in its place, not in the file.
- An agent never edits its own file: changing it is your job.
