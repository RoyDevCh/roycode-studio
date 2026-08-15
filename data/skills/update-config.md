---
description: Update local settings, hooks, permissions, or RoyCode-compatible configuration carefully.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
when_to_use: Use when the user asks for persistent automation, hook behavior, permissions, environment variables, or configuration changes.
argument-hint: "[configuration request]"
user-invocable: true
---
# Update Config

Modify configuration carefully and merge with what already exists.

## Important distinction

If the user wants something to happen automatically in response to an event, prefer a hook or settings change instead of only updating memory.

## Workflow

1. Determine the right scope:
   - user-level config
   - project-level config
   - local uncommitted config
2. Read the existing target file before editing.
3. Merge changes instead of replacing unrelated settings.
4. Preserve arrays and existing rules unless the user explicitly wants replacement.
5. When editing hooks, validate the command path, shell syntax, and expected trigger.

## Common targets

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- RoyCode local data/config files when the request is RoyCode-specific

## Rules

- If the request is ambiguous, ask a targeted question or clearly state the assumption you chose.
- Do not silently wipe existing config.
- Explain what changed and where.

## Requested change

$ARGUMENTS
