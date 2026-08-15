---
description: Diagnose a stuck, slow, or frozen RoyCode session on this machine.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
when_to_use: Use when the user thinks another local coding-agent session is stuck, frozen, leaking memory, or hanging on a subprocess.
argument-hint: "[optional pid, process name, or symptom]"
user-invocable: true
---
# Stuck

Investigate whether a local RoyCode session is stuck.

## Workflow

1. Inspect running processes that look relevant.
2. Look for:
   - sustained high CPU
   - child processes stuck under the parent
   - abnormal memory growth
   - stopped or zombie processes
   - repeated errors in logs or output
3. If you can identify a likely stuck subprocess, capture the command and explain why it looks unhealthy.
4. Produce a concise diagnostic report with:
   - pid or process name
   - symptoms
   - likely cause
   - safe next steps

## Rules

- Diagnostic only. Do not kill processes unless the user explicitly asks.
- Prefer concrete evidence such as process state, command lines, or recent logs.

## Focus

$ARGUMENTS
