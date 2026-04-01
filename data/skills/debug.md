---
description: Diagnose a RoyCode or Claude-style issue by inspecting logs, settings, commands, and recent behavior.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Agent
when_to_use: Use when the user is debugging RoyCode behavior, a failing workflow, or an issue that needs log inspection and root-cause analysis.
argument-hint: "[issue description]"
user-invocable: true
---
# Debug

Investigate the issue and explain likely causes in plain language.

## Workflow

1. Restate the reported symptom.
2. Inspect the most relevant local evidence:
   - logs
   - config files
   - recent commands
   - related code paths
3. Search for warnings, errors, and mismatched configuration.
4. Explain:
   - what you found
   - the most likely root cause
   - the next best fix or verification step

## Rules

- Prefer evidence over guesses.
- If logs are missing, say so and continue with the best available signals.

## Issue

$ARGUMENTS
