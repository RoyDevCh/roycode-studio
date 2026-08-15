---
description: Create or update keybindings.json safely without overwriting unrelated bindings.
allowed-tools:
  - Read
  - Write
  - Edit
when_to_use: Use when the user wants to customize keybindings or inspect an existing keybindings.json file.
argument-hint: "[binding change request]"
user-invocable: true
---
# Keybindings

Update keybindings carefully.

## Workflow

1. Read the existing `~/.claude/keybindings.json` if it exists.
2. Merge only the requested changes.
3. Keep the file minimal: only override contexts and keys that need to change.
4. If a default binding is being replaced, explicitly unbind the old shortcut when necessary.

## Rules

- Do not replace the whole file unless the user explicitly asks.
- Keep bindings valid JSON.
- Explain the final shortcut mapping clearly.

## Requested keybinding change

$ARGUMENTS
