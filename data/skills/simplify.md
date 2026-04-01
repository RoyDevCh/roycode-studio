---
description: Review changed code for reuse, quality, and efficiency, then fix the issues you find.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
  - Agent
  - Skill
when_to_use: Use when the user wants a cleanup pass after a code change, or when changed code should be simplified without changing the intended behavior.
argument-hint: "[optional focus area]"
user-invocable: true
---
# Simplify

Review the current change set and improve it without changing the requested behavior.

## Workflow

1. Inspect the diff first. Prefer `git diff`, `git diff --staged`, or recently edited files.
2. Run focused review passes for:
   - code reuse and duplicate logic
   - clarity and abstraction boundaries
   - efficiency and unnecessary repeated work
3. Use `run_subagent` when parallel review is useful, especially for larger diffs.
4. Fix the worthwhile issues directly.
5. Summarize what was simplified and what you intentionally left unchanged.

## What to look for

- Hand-rolled helpers that duplicate existing utilities
- New parameters or branches that should be absorbed into a cleaner abstraction
- Redundant state, derived values stored twice, or repeated file/network work
- Comments that narrate obvious code instead of explaining non-obvious constraints
- Repeated logic that should be shared

## Extra focus

$ARGUMENTS
