---
description: Turn a repeatable workflow from the current session into a reusable Claude-style skill.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
when_to_use: Use when the user wants to capture a successful workflow from this session into a reusable skill file.
argument-hint: "[optional description of the workflow to capture]"
user-invocable: true
---
# Skillify

Convert a repeatable process into a reusable skill.

## Workflow

1. Review the current session and identify the repeatable workflow.
2. Extract:
   - the goal
   - required inputs
   - ordered steps
   - success criteria
   - hard rules or user preferences
3. Draft a `SKILL.md` with Claude-style frontmatter:
   - `description`
   - `allowed-tools`
   - `when_to_use`
   - optional `argument-hint`
   - optional `arguments`
   - optional `context: fork`
4. Save it to either:
   - `.claude/skills/<name>/SKILL.md`
   - `~/.claude/skills/<name>/SKILL.md`
5. Tell the user how to invoke it and what to edit later if they want to refine it.

## Rules

- Keep the skill reusable and focused on one workflow.
- Prefer concrete steps over vague advice.
- If important details are missing, ask concise follow-up questions before writing.

## Workflow hint

$ARGUMENTS
