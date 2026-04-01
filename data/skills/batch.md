---
description: Plan and execute a large parallelizable change by splitting it into isolated units and tracking progress.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Agent
  - TaskCreate
  - TaskList
  - TaskGet
  - Skill
when_to_use: Use when the user wants a large, mechanical, or parallelizable change split across multiple independent work units.
argument-hint: "<large-scale change request>"
user-invocable: true
---
# Batch

Coordinate a large change in parallel.

## Workflow

1. Research the scope carefully and identify all impacted modules or file groups.
2. Break the work into independent units that can be executed without stepping on each other.
3. For each unit:
   - define a focused task
   - specify files or directories involved
   - specify the expected verification
4. Use subagents or background tasks to execute the units when parallel work is beneficial.
5. Track progress and summarize completed units, blockers, and remaining work.

## Rules

- Do not split work into overlapping ownership areas.
- Prefer directory, module, or feature boundaries over arbitrary file lists.
- Verification matters: each unit should include a realistic check.

## User request

$ARGUMENTS
