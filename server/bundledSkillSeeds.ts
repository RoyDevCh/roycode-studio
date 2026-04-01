export const BUNDLED_SKILL_SEEDS: Record<string, string> = {
  'simplify.md': `---
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

1. Inspect the diff first. Prefer \`git diff\`, \`git diff --staged\`, or recently edited files.
2. Run focused review passes for:
   - code reuse and duplicate logic
   - clarity and abstraction boundaries
   - efficiency and unnecessary repeated work
3. Use \`run_subagent\` when parallel review is useful, especially for larger diffs.
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
`,
  'verify.md': `---
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
`,
  'remember.md': `---
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

- Put project-wide rules in \`CLAUDE.md\`, \`.claude/INSTRUCTIONS.md\`, or other committed instruction files.
- Put RoyCode-local durable context in workspace memory.
- Keep temporary or session-specific notes out of durable files.

## Extra context

$ARGUMENTS
`,
  'update-config.md': `---
description: Update Claude-style settings, hooks, permissions, or RoyCode-compatible local configuration carefully.
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

- \`~/.claude/settings.json\`
- \`.claude/settings.json\`
- \`.claude/settings.local.json\`
- RoyCode local data/config files when the request is RoyCode-specific

## Rules

- If the request is ambiguous, ask a targeted question or clearly state the assumption you chose.
- Do not silently wipe existing config.
- Explain what changed and where.

## Requested change

$ARGUMENTS
`,
  'stuck.md': `---
description: Diagnose a stuck, slow, or frozen Claude Code or RoyCode session on this machine.
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

Investigate whether a local RoyCode or Claude-style session is stuck.

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
`,
  'skillify.md': `---
description: Turn a repeatable workflow from the current session into a reusable Claude-style skill.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
when_to_use: Use when the user wants to capture a successful workflow from this session into a reusable skill file.
argument-hint: "[optional description of the workflow to capture]"
user-invocable: true
---
# Skillify

Convert a repeatable process into a reusable skill.

## Workflow

1. Review the current session and identify the repeatable workflow.
2. Extract:
   - the goal
   - required inputs
   - ordered steps
   - success criteria
   - hard rules or user preferences
3. Draft a \`SKILL.md\` with Claude-style frontmatter:
   - \`description\`
   - \`allowed-tools\`
   - \`when_to_use\`
   - optional \`argument-hint\`
   - optional \`arguments\`
   - optional \`context: fork\`
4. Save it to either:
   - \`.claude/skills/<name>/SKILL.md\`
   - \`~/.claude/skills/<name>/SKILL.md\`
5. Tell the user how to invoke it and what to edit later if they want to refine it.

## Rules

- Keep the skill reusable and focused on one workflow.
- Prefer concrete steps over vague advice.
- If important details are missing, ask concise follow-up questions before writing.

## Workflow hint

$ARGUMENTS
`,
  'batch.md': `---
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
`,
  'debug.md': `---
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
`,
  'keybindings.md': `---
description: Create or update Claude-style keybindings.json safely without overwriting unrelated bindings.
allowed-tools:
  - Read
  - Write
  - Edit
when_to_use: Use when the user wants to customize Claude-style keybindings or inspect an existing keybindings.json file.
argument-hint: "[binding change request]"
user-invocable: true
---
# Keybindings

Update Claude-style keybindings carefully.

## Workflow

1. Read the existing \`~/.claude/keybindings.json\` if it exists.
2. Merge only the requested changes.
3. Keep the file minimal: only override contexts and keys that need to change.
4. If a default binding is being replaced, explicitly unbind the old shortcut when necessary.

## Rules

- Do not replace the whole file unless the user explicitly asks.
- Keep bindings valid JSON.
- Explain the final shortcut mapping clearly.

## Requested keybinding change

$ARGUMENTS
`,
  'lorem-ipsum.md': `---
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
`,
}

