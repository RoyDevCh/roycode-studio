---
description: Review workspace memory and instruction files, then propose durable updates or cleanups.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
when_to_use: Use when the user wants to organize memory, promote stable rules into CLAUDE.md or workspace memory, or clean up outdated instructions.
argument-hint: "[optional memory focus]"
user-invocable: true
---
# Remember

Review durable instructions and memory for this workspace.

## Workflow

1. Read the current workspace instruction files and workspace memory.
2. Identify:
   - stable conventions worth preserving
   - outdated or conflicting instructions
   - temporary notes that should stay out of durable memory
3. If the user asked for analysis only, propose the changes without applying them.
4. If the user explicitly asked you to update memory, write careful minimal edits.

## Sorting guide

- Put project-wide rules in `CLAUDE.md`, `.claude/INSTRUCTIONS.md`, or other committed instruction files.
- Put RoyCode-local durable context in workspace memory.
- Keep temporary or session-specific notes out of durable files.

## Extra context

$ARGUMENTS
