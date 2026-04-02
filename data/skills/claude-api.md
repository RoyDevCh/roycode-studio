---
description: Build or debug integrations against the Claude API using current official documentation and concrete examples.
allowed-tools:
  - WebSearch
  - WebFetch
  - Read
  - Grep
  - Glob
  - Bash
when_to_use: Use when the user wants to build with the Claude API, Anthropic SDKs, streaming responses, tools, prompt caching, or agent-style workflows.
argument-hint: "[Claude API task]"
user-invocable: true
---
# Claude API

Help the user build or debug a Claude API integration with current official guidance.

## Workflow

1. Confirm the user goal:
   - simple chat completion
   - streaming
   - tool use / function calling
   - files
   - batching
   - prompt caching
   - SDK usage
2. Fetch current official docs before giving implementation details.
3. Prefer official Anthropic documentation pages and SDK references.
4. Show a concrete implementation path:
   - required request shape
   - model choice
   - authentication / base URL assumptions
   - one realistic code sample
5. If the user already has code, review it against the docs and explain what is wrong.

## Rules

- Prefer official docs over memory.
- Be explicit when an answer is inferred from multiple docs.
- If the user asks for a code sample, tailor it to their language or stack.

## Request

$ARGUMENTS
