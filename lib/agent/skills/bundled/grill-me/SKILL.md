---
name: grill-me
description: Run a focused, structured interview with ask_user_question to resolve ambiguous goals, scope and design trade-offs before entering plan mode or building.
---

# Structured alignment interview

Use this skill when the request is broad, open-ended or has high-impact design choices that should be agreed before writing code or a plan.

## 1. Inspect the project first
- Read what already exists in the project before asking anything. Never ask the owner questions whose answers are already in the files, schema or settings.

## 2. Ask only high-leverage questions (1–2 short rounds)
- Use `ask_user_question` with concrete, plain-language options and a clear recommendation first when one choice is obviously stronger.
- Focus on decisions that change architecture, user flow, visual direction, data model or external integrations:
  - Target audience and primary goal of the page, app or tool
  - Must-have flows vs what stays out of scope for v1
  - Visual style, tone or brand constraints (if not already in the `brand` skill)
  - Data ownership, permissions or publishing/integration boundaries
- Skip trivia you can decide sensibly on your own.

## 3. Converge and hand off
- Summarize the agreed decisions in a short bulleted list (including explicit non-goals and open risks).
- If the task is complex enough for a plan, transition into `enter_plan_mode` (or write the plan if already in plan mode). Otherwise, proceed directly once the owner confirms.
