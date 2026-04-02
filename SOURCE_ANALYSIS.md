# Claude Code Snapshot Analysis

## Bottom Line

This snapshot is much closer to a full internal terminal product than to a simple chat CLI. The recovered code shows a rich React/Ink REPL, a large command registry, dozens of tools, permissions and policy layers, remote session plumbing, MCP integration, plugin and skill systems, task orchestration, session recovery, and multiple feature-gated internal modes.

It is not a clean public repository, though. The code shape strongly suggests a sourcemap-recovered source snapshot that still expects Anthropic-internal infrastructure, feature flags, private services, and private build assumptions. That is why rebuilding a practical companion app and terminal tool next to it is safer than trying to turn the snapshot itself into a drop-in public release.

## 1. Entry and Runtime Shape

- `main.tsx` is the real heart of the product, not a thin bootstrap.
- It imports telemetry, auth, permissions, remote session code, MCP, plugins, skills, updater logic, analytics gates, migrations, session restore, sandbox state, and model configuration before launching the REPL.
- `replLauncher.tsx` confirms the terminal UI is not plain `readline`; it mounts `App` and `REPL` through a React/Ink renderer.

What this means:

- Claude Code is architected like a full terminal application shell.
- The "CLI" is really an app runtime with an interactive UI, not just a command parser.

## 2. Command System

- `commands.ts` is a central registry for built-in commands.
- The file references a very large command surface: `review`, `resume`, `permissions`, `plan`, `tasks`, `files`, `mcp`, `plugin`, `skills`, `branch`, `teleport`, `status`, `model`, `theme`, `vim`, `desktop`, `ide`, `memory`, `hooks`, and more.
- Many commands are feature-gated with Bun bundle flags such as `KAIROS`, `ULTRAPLAN`, `BUDDY`, `VOICE_MODE`, `BRIDGE_MODE`, and `FORK_SUBAGENT`.

What this means:

- The original product is command-extensible and heavily modularized.
- A Claude-Code-like clone should prioritize slash commands and tool workflows, not just a plain prompt loop.

## 3. Tooling Architecture

The recovered tree contains explicit tool implementations under `tools/`, including:

- `BashTool`
- `FileReadTool`
- `FileWriteTool`
- `FileEditTool`
- `GlobTool`
- `GrepTool`
- `WebSearchTool`
- `WebFetchTool`
- `MCPTool`
- `AgentTool`
- multiple task/team tools

What this means:

- The agent is designed around structured tool calls, not only prompt engineering.
- The best local reconstruction path is to preserve that pattern: model -> tool loop -> structured output -> user-visible transcript.

## 3.5. Prompt Architecture

- The snapshot does not rely on a single flat system prompt string.
- `utils/systemPrompt.ts` builds an effective prompt by composing default prompts, agent prompts, custom prompts, coordinator prompts, and append-only addenda.
- `constants/systemPromptSections.ts` shows that sections are memoized and sometimes intentionally cache-breaking.
- Many tools have dedicated `prompt.ts` files, which means behavior is shaped both by the main system prompt and by tool-local instruction layers.

What this means:

- A faithful local rebuild should not stop at "one configurable system prompt".
- It should support layered prompt composition, workspace instructions, skill prompts, and task/memory policy prompts.

## 4. Permissions and Safety

- `utils/permissions/*` and `commands/permissions/*` show that permissions are first-class runtime state.
- `main.tsx` imports permission bootstrap helpers such as `initialPermissionModeFromCLI`, `initializeToolPermissionContext`, `removeDangerousPermissions`, and auto-mode guards.
- There is clear separation between safe defaults and more permissive modes.

What this means:

- Claude Code is not "full access by default"; it is "explicit permission model with escalation paths".
- Any faithful local clone should expose fast switching between safe mode and full mode, instead of silently behaving like a permanently unrestricted shell.

## 5. Session, Resume, and Recovery

- `commands/resume/` exists as a first-class command.
- `main.tsx` imports `loadConversationForResume`, `processResumedConversation`, `searchSessionsByCustomTitle`, `cacheSessionTitle`, and related session-storage helpers.
- This suggests durable transcript/session storage is a core product feature, not an afterthought.

What this means:

- A serious local rebuild should support resumable sessions, searchable history, and stable conversation identity.

## 6. Remote, Bridge, and Direct Connect

- The `bridge/` directory is extensive and contains bridge transport, config, UI hooks, status helpers, and session runners.
- `server/createDirectConnectSession.ts` and related remote/session files suggest direct-connect or daemonized operation.
- `main.tsx` imports remote session creation, direct-connect, teleport, and session ingress auth helpers.

What this means:

- The original tool is not only local-terminal bound.
- It already had remote control and multi-surface architecture underneath the CLI.

## 7. Tasks, Multi-Agent, and Background Work

- The `tasks/` directory includes local shell, local agent, remote agent, and in-process teammate task types.
- `AgentTool` and swarm-related helpers in `utils/swarm/*` suggest explicit multi-agent and teammate workflows.
- `services/autoDream/` indicates a background memory-consolidation subsystem.

What this means:

- Claude Code is closer to an agent platform than a single prompt-response shell.
- "All features" in the strict sense would require task orchestration, subagent coordination, and background processing, not only chat + file edit.

## 8. Memory, Skills, Plugins, MCP

- `skills/`, `plugins/`, and `services/mcp/` are all substantial directories.
- `commands.ts` registers commands around MCP, plugins, and skills directly.
- `main.tsx` initializes bundled plugins, bundled skills, MCP resources, remote managed settings, and plugin versioning.
- `services/SessionMemory/prompts.ts` and `services/extractMemories/prompts.ts` show that the product also has a dedicated memory-update workflow, not just ad hoc prompt context.
- `claude-directory` style project files are a first-class part of the product shape: rules, output styles, agent memory, settings, nested `.claude` discovery, and project `.mcp.json` all appear in either the official docs, the recovered source, or both.

What this means:

- Extensibility is a core product layer.
- A realistic local clone can approximate this by supporting provider presets, local skills/plugins, MCP-style connectors, workspace/session memory, rules, output styles, agent memory, and bundled built-in skills, but full parity would require a much larger ecosystem implementation.
- RoyCode now includes a practical local subset of this layer: imported plugin directories with markdown commands and skills, project/user `.claude/skills`, project/user `.claude/commands`, project/user `.claude/agents`, project/user `.claude/rules`, project/user `.claude/output-styles`, project/user/local agent memory files, source-inspired bundled skills such as `simplify`, `verify`, `remember`, `update-config`, `skillify`, `batch`, and `debug`, plugin-provided output styles, a Claude-style `skill` execution path, local subagent execution, project `.mcp.json` auto-discovery, and user-configured MCP servers for tools, prompts, and resources.
- RoyCode also now exposes local MCP inspection and edit flows for saved servers, including persisted HTTP headers, bearer tokens, and stdio environment overrides, which approximates part of the snapshot's richer MCP management surface without depending on Anthropic's hosted registry.

## 9. Model and Provider Layer

- `utils/model/*` appears to normalize model strings, capabilities, deprecations, provider routing, and context windows.
- The code clearly separates user-facing model names from provider-specific runtime identifiers.

What this means:

- The original system already treats "model choice" as a capability/configuration problem, not just a single hardcoded API endpoint.
- This supports the path of making a multi-provider local tool with DeepSeek, MiniMax, and compatible OpenAI-style backends.
- RoyCode now also carries a local `effortLevel` runtime setting so prompt policy and step-budget shaping can vary without hardcoding one reasoning depth.
- RoyCode now also supports extra workspace directory allowlists and persisted shell environment overrides, which are both useful local approximations of the snapshot's richer workspace/terminal runtime.

## 10. Web and Current-Info Capabilities

- The original snapshot contains `tools/WebSearchTool/` and `tools/WebFetchTool/`.
- This confirms that external information retrieval is part of Claude Code's intended toolset.

What this means:

- A local rebuild that cannot search or fetch the public web is missing a meaningful capability.
- That gap is one of the most important practical differences between a local coding assistant and a more complete Claude-Code-like agent.

## 11. Product Conclusion

If the question is "Can this leaked kernel be pushed toward a Claude-Code-like terminal tool?", the answer is yes.

If the question is "Can this exact snapshot be turned into the official product with every internal feature intact?", the answer is no, not from this repo alone.

The biggest blockers are:

- private Anthropic infrastructure and APIs
- feature-flagged internal-only modes
- missing public packaging/build assumptions
- closed remote services, policy systems, and auth flows

## 12. Practical Rebuild Strategy

The most realistic path is:

1. Preserve the terminal-first workflow.
2. Preserve the command-and-tool model.
3. Add resumable sessions, permissions, file tools, shell tools, Git tools, and web tools.
4. Keep provider abstraction open so third-party models can be swapped in.
5. Treat the desktop/WebUI surface as optional, not the core identity.

That is exactly why this project now fits better as a Claude-Code-like terminal companion than as a Codex-desktop clone.

## 13. Snapshot vs. Local Rebuild

Below is the practical comparison between the recovered Claude Code snapshot and the current RoyCode rebuild in this repo.

| Capability | Snapshot shows it? | RoyCode local rebuild now | Notes |
| --- | --- | --- | --- |
| Terminal-first REPL | Yes | Yes | RoyCode CLI is the main practical surface. |
| Structured file tools | Yes | Yes | Read, write, replace, list, search, pending approval flow. |
| Shell command execution | Yes | Yes | Full-access mode is available, but still bounded by the current Windows user account. |
| Provider/model abstraction | Yes | Yes | Multi-provider settings and model switching are implemented. |
| Session resume/history | Yes | Yes | Saved CLI sessions, resume, title, list, delete. |
| Permission modes | Yes | Yes | `workspace`, `unrestricted`, and quick permission presets exist locally. |
| Git workflow | Yes | Partially | Status, diff, stage, unstage, commit are present; deeper official workflows are not fully mirrored. |
| GitHub issue / PR discussion context | Yes | Partially | RoyCode now supports local GitHub issue listing, issue detail reads, and PR comment inspection for the current origin repo, but not the snapshot's full hosted GitHub app workflows. |
| Web search / fetch | Yes | Yes | Public web search and readable web fetch are integrated, though some bot-protected sites can still block fetches. |
| Local docs discovery | Partially | Yes | RoyCode now includes `MagicDocs`-style workspace markdown/text discovery, search, and document reads for repo-local documentation. |
| React/Ink terminal UI | Yes | Partially | The original snapshot uses a richer Ink app shell; RoyCode now has an Ink-style TUI launcher with workspace/session panels, shortcut hints, recent input history, live output, and surfaced mode/theme/vim session state over its local CLI core, but it is still simpler than the original REPL app. |
| Desktop companion | Implied | Yes | Electron desktop shell exists locally, but it is not the same product surface as official Codex/Claude desktop apps. |
| Prompt composition | Yes | Partially | RoyCode now has segmented system-prompt building, but not the snapshot's full internal mode graph. |
| Workspace instructions and memory | Yes | Partially | RoyCode now auto-loads workspace instruction files, agent memory, persistent workspace memory, rules, and output styles, but not the full extraction/consolidation system. |
| Skills / plugins / MCP | Yes | Partially | RoyCode now has project/user `.claude/skills`, nested `.claude` discovery from the current working directory, project/user `.claude/commands`, project/user `.claude/agents`, bundled source-inspired skills, imported plugin commands, plugin-provided skills, a Claude-style `skill` tool path, and user-configured MCP servers with tool/prompt/resource access, but not the snapshot's official registry/auth ecosystem. |
| Rules / output styles / project settings | Yes | Partially | RoyCode now supports `.claude/rules`, `.claude/output-styles`, plugin output styles, `outputStyle` config, and project `.mcp.json`; deeper managed settings and enterprise policy layers are still absent. |
| Multi-agent task orchestration | Yes | Partially | RoyCode now has project/user `.claude/agents`, `run_subagent`, background tasks, task update/stop/restart/output flows, and agent task tools, but not the snapshot's full teammate/subagent platform. |
| Team runtime | Yes | Partially | RoyCode now has local teams, member management, team-run workflows, and per-member background task fan-out, but not the snapshot's full teammate platform or remote orchestration layer. |
| Worktree workflow | Yes | Partially | RoyCode now supports local git worktree listing, inspection, creation, removal, switching, and teleport-style workspace switching, but not the snapshot's full managed isolation model. |
| Notebook editing | Yes | Partially | RoyCode now supports local `.ipynb` cell listing, reading, insertion, replacement, and deletion, but not notebook kernel execution or rich-output replay. |
| LSP / code intelligence | Yes | Partially | RoyCode now has a local TypeScript/JavaScript LSP subset for diagnostics, definitions, implementations, references, rename preview, rename apply through safe-write or direct writes, hover, document symbols, and workspace symbols; broader language-server coverage is still absent. |
| Structured user questions | Yes | Partially | The source snapshot includes explicit interactive question tooling; RoyCode now supports a local `ask_user_question` path in the CLI and TUI, but not every surface can interrupt and collect answers yet. |
| Scheduled automation / cron | Yes | Partially | The source snapshot has cron-style scheduling helpers; RoyCode now supports workspace-local scheduled prompts, a lightweight scheduler, and `/cron` management commands, but not the full official automation/product layer. |
| Plan / execution modes | Yes | Partially | RoyCode now supports a read-only `plan-mode` with blocked write paths and a `worktree-mode` session flow, but it still does not reproduce every official mode transition or policy nuance. |
| Conversation workflow commands | Yes | Partially | RoyCode now has `/branch`, `/summary`, `/thinkback`, `/compact`, `/rewind`, and `/export`, but not the full official Ink session shell. |
| Structured hooks | Yes | Partially | RoyCode hooks now receive JSON stdin and can return structured JSON results, and they cover a broad local subset of Claude-style lifecycle events and matcher filtering, but they still do not cover every official hook event or decision type. |
| Remote bridge / direct connect | Yes | Partially | The snapshot contains substantial bridge/remote plumbing; local rebuild focuses on local-first execution. |
| Private cloud auth / internal services | Yes | No | This is the main hard boundary for full parity. |

## 14. Honest Feasibility

What can be rebuilt locally:

- a Claude-Code-like terminal workflow
- slash commands and structured tools
- Claude-style `-p/--print` execution plus project/user `.claude/skills`, `.claude/commands`, `.claude/rules`, `.claude/output-styles`, and agent-memory compatibility
- install/runtime inspection commands such as local `version`, `release-notes`, and `upgrade status/run`
- extra working-directory and shell-environment controls that keep local terminal flows flexible without forcing fully unrestricted mode
- GitHub issue and PR discussion inspection for the current origin repo
- local repository documentation discovery and search
- Claude-style project/user `.claude/agents` compatibility and current-directory nested `.claude` discovery
- resumable sessions
- layered prompt composition
- workspace instruction loading and persistent local memory
- project `.mcp.json` discovery and local MCP registry merging
- local plugin markdown commands and plugin skills
- plugin output styles
- user-configured MCP servers over stdio or Streamable HTTP
- self-hosted bridge endpoints between RoyCode servers over HTTP
- self-hosted marketplace entries for local skills and plugins from paths or git URLs
- local brief/voice preferences, statusline helpers, and keybinding surfacing in the TUI/CLI shell
- local team inbox messages and team memory sync built on top of the task/subagent runtime
- guarded team memory writes with high-confidence secret scanning before persistence
- local browser helpers, remote HTTP triggers, and portable settings bundle export/import
- local worktree workflows
- local notebook cell editing
- local TypeScript/JavaScript code intelligence
- structured terminal follow-up questions
- local scheduled prompt automation
- plan-mode and worktree-mode session flows
- full local filesystem and shell access
- Git-aware coding flows
- model/provider abstraction
- current-info workflows through web search and fetch
- workspace memory extraction and richer local session analysis helpers

What cannot be fully rebuilt from this snapshot alone:

- Anthropic internal auth and policy services
- private feature-flagged modes
- closed remote infrastructure
- exact official terminal UI behavior and hidden product logic

So the right expectation is not "perfect official clone." The right expectation is "very strong local terminal companion built from the visible architecture patterns in the snapshot." That is feasible, and that is the direction this repo now follows.
