---
description: Verify that a code change really works by running the app, tests, or a realistic workflow.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Agent
when_to_use: Use when the user asks to verify a change, confirm a fix, test a workflow, or make sure the app behaves correctly end to end.
argument-hint: "[what to verify]"
user-invocable: true
---
# Verify

Confirm that the target change works in practice, not only in theory.

## Workflow

1. Identify what changed and what user-visible behavior or code path must be verified.
2. Find the best verification route:
   - existing tests
   - a dev server plus HTTP requests
   - a CLI workflow
   - a build or lint check
   - a local run of the affected script or app
3. Execute the strongest realistic verification you can perform locally.
4. Record:
   - commands run
   - key outputs
   - whether behavior matched expectations
   - any remaining gaps you could not verify

## Rules

- Prefer direct evidence over speculation.
- If verification requires setup, explain the missing prerequisite briefly and continue with the best available alternative.
- If tests fail because of a real issue in the change, explain that clearly.

## Target

$ARGUMENTS
