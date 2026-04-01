---
description: Generate filler text for layout, prompt, or long-context testing.
allowed-tools: []
when_to_use: Use when the user wants placeholder prose, sample long-form text, or approximate token-count filler.
argument-hint: "[approximate token count or description]"
user-invocable: true
---
# Lorem Ipsum

Generate filler text for testing.

## Rules

- Honor the requested size as closely as practical.
- If the user asks for a token count, aim for that size approximately and say it is approximate.
- Keep the output as plain filler text unless the user asks for a particular style or structure.

## Request

$ARGUMENTS
