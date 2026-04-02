# RoyCode Studio

RoyCode Studio is a personal WebUI coding workspace built next to the Claude Code source snapshot in this repo. The goal is not to rebuild the leaked CLI exactly as-is, but to turn the useful ideas in that snapshot into a practical multi-model coding tool with a browser interface.

Further reading:

- [USER_MANUAL.md](./USER_MANUAL.md) - day-to-day usage guide for CLI, TUI, WebUI, and desktop workflows
- [DEVELOPMENT_MANUAL.md](./DEVELOPMENT_MANUAL.md) - architecture and extension guide for future RoyCode development

## What It Supports

- Quick-add API presets for DeepSeek, MiniMax, and custom OpenAI-compatible endpoints
- Persistent provider settings in `personal-webui/data/settings.json`
- Provider model visibility and model refresh
- Streaming chat with tool activity shown in real time
- Chat-first UI inspired by modern LLM products, with a left conversation rail and right workspace dock
- Light and dark themes with product-style topbar actions
- Collapsible chat rail, collapsible workspace dock, and draggable dock resizing
- A dedicated Git dock with branch/status, diff preview, stage/unstage, attach-changed-file, and commit actions
- An Electron desktop shell with a native app window, app menu, and local backend boot
- Desktop builds now compile the backend into `dist-server/` and can produce a portable Windows executable
- A terminal-first `RoyCode CLI` that behaves much closer to Claude Code than the WebUI does
- The `roycode` launcher now defaults to the native single-process TUI, while `roycode --plain` opens the direct line-based CLI explicitly
- RoyCode CLI now supports saved sessions, `/resume`, `/title`, `/sessions`, and one-shot `--prompt` runs
- RoyCode CLI now supports Claude-style `-p` / `--print` runs with optional JSON output
- RoyCode CLI includes local slash commands for files, search, shell, pending changes, Git, provider/model switching, and review/fix/plan/explain macros
- RoyCode CLI and the shared agent now include built-in `web_search` and `web_fetch` support for current information and public docs lookup
- RoyCode CLI now supports local `skills`, event `hooks`, and background `tasks` for a more agent-like terminal workflow
- RoyCode now auto-loads Claude-style project `.claude/skills`, user `~/.claude/skills`, and project/user `.claude/commands`
- RoyCode now auto-loads Claude-style project/user `.claude/agents` and can run them as local subagents
- RoyCode now follows Claude-style source priority more closely, with user-level `.claude` entries overriding project-level entries and nested project directories being discovered from the current `cwd`
- RoyCode now supports Claude-style `.claude/rules`, `.claude/output-styles`, and `.claude/agent-memory`, including nested project discovery from the current `cwd`
- RoyCode now supports project `.mcp.json` auto-discovery and can merge those MCP servers with RoyCode's saved local MCP registry
- RoyCode now supports plugin-provided output styles from `output-styles/*.md`, in addition to built-in and `.claude/output-styles` styles
- RoyCode now includes a local git `worktree` workflow, worktree inspection, switching shortcuts, and `teleport` shortcuts for moving the session into another worktree quickly
- RoyCode now includes a local notebook runtime for `.ipynb` cell listing, reading, editing, insertion, and deletion with the same safe-write flow as normal files
- RoyCode now includes local `teams` so several named subagents or roles can be grouped, run together, or launched as parallel background tasks
- RoyCode now includes a self-hosted `bridge` layer that can talk to another RoyCode server over HTTP for health, context, and remote command execution
- RoyCode now includes a self-hosted `marketplace` registry for installable local skills or plugins from a path or git URL
- RoyCode now includes a local TypeScript/JavaScript `LSP` subset for diagnostics, definitions, implementations, references, rename preview, rename apply, hover, document symbols, and workspace symbols
- RoyCode now ships a bundled local skill set adapted from the source snapshot, including `simplify`, `verify`, `remember`, `update-config`, `skillify`, `batch`, `debug`, `keybindings`, `stuck`, `lorem-ipsum`, and `claude-api`
- RoyCode CLI now supports local plugins with markdown command loading, direct `/plugin-name:command` execution, and plugin-provided skills
- RoyCode now supports user-configured local MCP servers over `stdio` and Streamable HTTP, including MCP tools, prompts, and resources
- RoyCode now supports structured in-terminal follow-up questions through the shared `ask_user_question` tool path, so a running agent can request constrained answers instead of only free-form text
- RoyCode now supports local scheduled prompts with `/cron`, workspace-local `.claude/scheduled_tasks.json`, and a lightweight background scheduler that can fire saved prompts into background tasks
- RoyCode now supports `plan-mode` for read-only planning passes, with both agent-tool and direct-command write paths blocked until you exit the mode
- RoyCode now supports `worktree-mode`, which can temporarily bind a session to an isolated git worktree and restore the base workspace later
- RoyCode now builds a richer segmented system prompt with workspace instructions, workspace memory, task policy, skill policy, and runtime policy sections
- RoyCode can auto-load workspace instruction files such as `CLAUDE.md`, `ROYCODE.md`, `.claude/INSTRUCTIONS.md`, and `.github/copilot-instructions.md`
- RoyCode includes persistent workspace memory files and CLI memory commands so stable project context can survive across sessions
- RoyCode CLI now supports Claude-style `/context`, `/doctor`, `/config`, `/rules`, `/output-style`, `/agent-memory`, and `/todos`
- The shared agent now exposes Claude-style compatibility helpers such as `skill`, `present_files`, `run_subagent`, `list_skills`, `read_skill`, `list_tasks`, `get_task`, and `create_task`
- The shared agent now also exposes `tool_search`, `list_rules`, `read_rule`, `list_output_styles`, `get_config`, `set_config`, `read_todos`, `todo_write`, `list_commands`, and `read_command`
- Claude-style `allowed-tools`, `tools`, and `disallowedTools` names such as `Read`, `Grep`, `Bash`, `WebFetch`, and `Agent` are now mapped onto RoyCode's local tool names
- RoyCode CLI supports pasted multi-line input via `/multiline` and non-interactive stdin piping for scripted use
- RoyCode CLI now supports Claude-style conversation workflow commands such as `/compact`, `/rewind`, and `/export`
- RoyCode CLI now also supports conversation branching, session summaries, and local history insights through `/branch`, `/summary`, `/thinkback`, and `/insights`
- RoyCode CLI now supports local theme and vim-mode preferences through `/theme` and `/vim`
- RoyCode CLI now supports local brief-mode and voice-mode preferences through `/brief` and `/voice`
- RoyCode CLI now supports local prompt suggestions, usage/cost statistics, advisor-model second opinions, and reasoning effort presets
- RoyCode CLI now supports local `version`, `release-notes`, and `upgrade status/run` flows for inspecting and refreshing the installed checkout
- RoyCode CLI now supports a dedicated `security-review` workflow for focused risk and regression auditing
- RoyCode CLI now supports `add-dir` style extra workspace directories, so workspace mode can safely cover more than one root without switching to unrestricted access
- RoyCode CLI now supports persisted shell environment overrides through `/env`, and these overrides flow into local shell tools across CLI, agent runs, and Web/Desktop backend commands
- RoyCode CLI now supports local `MagicDocs`-style repo documentation discovery through `/magic-docs` and `/docs`
- RoyCode CLI now supports local GitHub issue and PR comment inspection through `/issue` and `/pr-comments` when the workspace origin points at GitHub
- RoyCode CLI now supports local notifications and a sleep-guard toggle for long-running workflows
- RoyCode voice support now includes local Windows speech-to-text capture for dictated prompts
- RoyCode CLI now supports Claude-style session helper commands such as `/session`, `/statusline`, and `/keybindings`
- RoyCode CLI now includes a local control plane for feature flags, policy profiles, privacy mode, diagnostics, trace capture, extra usage inspection, and debug/admin-style terminal commands
- RoyCode background tasks now support output inspection, prompt updates, cancellation, and restart flows from both the CLI and the shared agent tools
- RoyCode teams now support per-member inbox messages, shared team memory, memory sync from recent team messages, and secret scanning before memory writes
- RoyCode now supports local settings bundle export/import so a machine can sync non-secret or redacted runtime setup through `/settings-sync`
- RoyCode now supports local remote triggers that can hit saved HTTP endpoints from the CLI or the shared agent
- RoyCode now supports local browser helpers through `/chrome open`, `/chrome search`, and `/chrome review`
- RoyCode now supports workspace memory extraction through `/memory extract`
- RoyCode now includes a simple local text-to-speech voice helper on Windows when voice mode is enabled
- RoyCode now also includes local runtime statistics, usage logging, cost estimation summaries, and top-tool usage buckets
- RoyCode MCP management now supports server inspection plus persisted header, bearer-token, and environment-variable edits for saved servers
- RoyCode CLI now includes local `ctx-viz`, `terminal-setup`, and `desktop` helper commands for inspecting loaded context and local launch/install entry points
- RoyCode hooks now accept JSON stdin and structured JSON stdout so hooks can emit `systemMessage`, block execution, attach extra context, mutate prompt input, and filter by matcher text or regex more like Claude Code hooks
- Sidebar project rail for quick workspace switching, with a chat list that behaves more like a project tree + session tree
- Project rail now supports search, favorites, and recent-project grouping
- Project nodes in the sidebar can expand to reveal their recent chats, so the left rail behaves more like a project tree + session tree
- Project rail now supports view filters and direct "new chat in this project" actions
- Project chat nodes in the sidebar now support direct pin, archive, and delete actions without leaving the tree
- Sidebar and session cards now support direct rename flows and delete confirmation for chat management
- A Ctrl+K quick switcher now lets you search projects, chats, tabs, and common actions from one place
- Project cards and one-click workspace switching for local coding workspaces
- Workspace file browsing and in-browser editing
- Session search and file search
- Chat history management with pinned chats, archived chats, per-project session grouping, drag sorting, and tags
- Prompt attachments for current workspace files and uploaded local text files
- Prompt attachments now support images too, with drag-and-drop upload, paste-from-clipboard screenshots, and in-chat previews
- Drag-and-drop files directly into the composer to attach them as prompt context
- Slash-command style task shortcuts such as `/review`, `/fix`, `/plan`, `/git`, and `/status`
- Desktop mode can open a native folder picker so you can switch workspace roots without hand-typing paths
- Filesystem access mode can be switched between `workspace` and `unrestricted`, so the desktop app can browse and edit absolute local paths outside the current workspace root
- Local chat archive export/import so histories can be moved between machines
- Code-block rendering with one-click copy and send-to-editor actions
- Direct code-block replace for the currently opened file so you can review the diff immediately
- Code blocks can also stage/write directly into the current file so they enter the existing approval flow
- Code blocks can first open a local draft diff so you can review before staging or writing
- Assistant replies now render markdown blocks such as headings, lists, quotes, tables, links, and inline code
- Code blocks now show syntax highlighting and line numbers for a more IDE-like reading experience
- Diff preview for the current file
- Pending changes support source filters and batch apply for visible results
- Visible pending changes can also be batch rejected to clear an approval queue faster
- Pending diffs can be split into patch chunks so individual hunks can be previewed, multi-selected, and staged on their own
- Built-in terminal panel with command history
- Safe write mode with pending-change approval before disk writes
- Keyboard shortcuts for common layout and dock navigation actions
- Per-change approval with inline diff preview for staged edits
- Draft patch preview inside the Changes panel before a write enters the approval queue
- Draft patches can be split into chunks so you can keep, preview, or stage only selected hunks
- Multi-session tabs so each chat can keep its own model, file, and terminal context

## New Machine Setup

The GitHub repo is enough to deploy RoyCode on another computer, but that machine still needs a local runtime first.

Prerequisites:

- Windows is the primary tested target
- Node.js and npm must already be installed
- Git is recommended so you can clone and update the repo
- Your model API keys must be configured again on the new machine after first launch

Recommended source install flow:

```bash
git clone https://github.com/RoyDevCh/roycode-studio.git
cd roycode-studio
npm install
npm run build
```

If you want the global terminal command on that machine too:

```bash
npm run install:command
roycode
roycode-full
```

If you only want the browser app on the new machine:

```bash
npm run start
```

If you want the desktop app from source:

```bash
npm run desktop
```

If you want a portable Windows package that can be copied to another machine:

```bash
npm run desktop:dist
```

After first launch on a new computer:

- add your provider API keys again
- choose the workspace you want to use
- reopen the terminal once if `roycode` was just installed into PATH

## Configure Models

RoyCode supports provider presets for `DeepSeek`, `MiniMax`, and custom OpenAI-compatible APIs.

The easiest way to configure models:

- start the WebUI or desktop app
- open the `Models` panel
- click a preset card such as `DeepSeek` or `MiniMax`, or add a `custom` provider
- fill in `Base URL`, `API Key`, `Models`, and `Default Model`
- save the provider, then pick it as the active provider/model

You can also edit the local settings file directly:

- settings path: `personal-webui/data/settings.json`
- important fields:
  - `providers`: the saved provider list
  - `selectedProviderId`: the active provider
  - `selectedModel`: the active model

Provider object format:

```json
{
  "id": "your-provider-id",
  "name": "DeepSeek",
  "preset": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "YOUR_API_KEY",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "enabled": true,
  "defaultModel": "deepseek-chat"
}
```

Example custom OpenAI-compatible provider:

```json
{
  "id": "my-openai-compatible-provider",
  "name": "My Provider",
  "preset": "custom",
  "baseUrl": "https://your-openai-compatible-host/v1",
  "apiKey": "YOUR_API_KEY",
  "models": ["model-a", "model-b"],
  "enabled": true,
  "defaultModel": "model-a"
}
```

Common preset examples:

- DeepSeek:
  - `baseUrl`: `https://api.deepseek.com`
  - common models: `deepseek-chat`, `deepseek-reasoner`
- MiniMax:
  - `baseUrl`: use the OpenAI-compatible endpoint provided by your MiniMax account
  - common models: fill the exact names returned by your MiniMax account or the model refresh action
- Custom:
  - `baseUrl`: any OpenAI-compatible `/v1` endpoint
  - `models`: whatever that provider exposes

CLI model switching:

```bash
/providers
/provider <id-or-name>
/models
/model <model-name>
```

If you already have an API-compatible provider but are unsure which models are available, save the provider first and then use the model refresh action in the `Models` panel.

## Run It

```bash
npm install
npm run dev
```

Development URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

Production build:

```bash
npm run build
npm run start
```

Terminal CLI:

```bash
npm run cli
```

Ink-style TUI:

```bash
npm run tui
```

The TUI now keeps a small workspace/session panel, shortcut rail, recent input list, and a live output pane so the default `roycode` launcher feels closer to a terminal application instead of a plain line prompt.

The TUI also now surfaces the current execution mode, theme preference, and vim-mode preference from the shared CLI runtime state, plus direct shortcuts for `/cron`, `/worktree`, and `/plan-mode status`, so it behaves more like a lightweight terminal app shell than a thin wrapper.

Global terminal command:

```bash
npm run install:command
roycode
roycode-full
```

Built terminal CLI:

```bash
npm run cli:built
```

Example CLI usage:

```bash
npm run cli -- --resume latest
npm run cli -- --workspace "C:\\my-project" --prompt "Review the repo and list the top risks"
roycode --web-search "TypeScript handbook site:typescriptlang.org"
roycode --web-fetch "https://www.typescriptlang.org/docs/handbook/intro.html"
roycode -p "Summarize the current workspace status in 3 bullets"
roycode --skill code-review
roycode --resume latest
roycode-full
roycode --plain
roycode --prompt "Look up the latest public docs for OpenAI responses API and summarize the key points"
```

Useful CLI flows:

```bash
/skills
/commands
/commands show review
/agents
/agent show auditor
/context
/doctor
/magic-docs search auth
/magic-docs show README.md
/issue list open 10
/pr-comments 123
/rules all
/output-style
/output-style set explanatory
/config get outputStyle
/todos add "ship context command"
/todos
/compact
/rewind 1
/export clipboard
/session info
/statusline
/keybindings
/brief toggle
/voice on
/skill use code-review
/plugins
/plugin import "C:\\path\\to\\plugin-dir"
/plugin commands
/my-plugin:review auth module
/memory
/memory append "The main build command is npm run build"
/memory extract
/instructions
/mcp add-stdio smoke node dist-server/mcp-smoke-server.js
/mcp tools smoke
/mcp call smoke echo {"text":"hello"}
/hook add instructions-loaded "Write-Output hook-fired" --match CLAUDE.md
/worktree
/worktree show feature-branch
/worktree add "..\\repo-wt" feature-branch
/teleport worktree feature-branch
/plan-mode enter review-risky-refactor
/plan-mode exit
/worktree-mode enter feature-branch
/worktree-mode exit
/cron
/cron add "0 9 * * 1-5" "Review workspace changes and summarize risks"
/notebook cells notebook.ipynb
/lsp defs src/index.ts 10 5
/lsp impl src/index.ts 10 5
/lsp rename-preview src/index.ts 10 5 RenamedSymbol
/lsp rename-apply src/index.ts 10 5 RenamedSymbol
/lsp workspace-symbols handler
/team create reviewers reviewer,security
/team message reviewers reviewer security "Check auth edge cases"
/team inbox reviewers security
/team memory reviewers sync
/chrome search "TypeScript language service rename API"
/remote-trigger add smoke https://example.com POST
/remote-trigger
/settings-sync export "C:\\temp\\roycode-sync.json" --redact-secrets
/team task reviewers "Audit the current auth changes"
/bridge add local http://127.0.0.1:8787
/marketplace add smoke-skill auto "C:\\path\\to\\skill"
/task start "Review the workspace and list the top risks"
/tasks
```

Claude-style compatibility notes:

- Project-local skills: `.claude/skills/**/SKILL.md` and `.claude/skills/**/*.md`
- User-local skills: `~/.claude/skills/**/SKILL.md` and `~/.claude/skills/**/*.md`
- Project-local slash commands: `.claude/commands/**/*.md`
- User-local slash commands: `~/.claude/commands/**/*.md`
- Project-local subagents: `.claude/agents/**/*.md`
- User-local subagents: `~/.claude/agents/**/*.md`
- Project-local rules: `.claude/rules/**/*.md`
- User-local rules: `~/.claude/rules/**/*.md`
- Project-local output styles: `.claude/output-styles/**/*.md`
- User-local output styles: `~/.claude/output-styles/**/*.md`
- Agent memory: `.claude/agent-memory/<agent>/MEMORY.md`, `.claude/agent-memory-local/<agent>/MEMORY.md`, and `~/.claude/agent-memory/<agent>/MEMORY.md`
- Project `.mcp.json` servers: `.mcp.json`
- Imported skill bundles: markdown files, skill directories, `.skill`, and `.zip`
- Built-in bundled skills are auto-seeded into `personal-webui/data/skills/` the first time RoyCode loads local skills
- Nested skill and command names resolve with `namespace:child` style names
- Nested project `.claude/skills`, `.claude/commands`, `.claude/agents`, `.claude/rules`, and `.claude/output-styles` are discovered from the current `cwd` back up to the workspace root

Settings sync and local trigger notes:

- `/settings-sync export <path>` writes a portable bundle of local RoyCode settings, hooks, teams, bridges, marketplace entries, MCP servers, plugins, and local skills/plugins
- Add `--redact-secrets` when exporting bundles you plan to copy to another machine or share with someone else
- `/settings-sync import <path>` restores the bundle into the local RoyCode data directory while preserving existing provider API keys when the imported bundle contains redacted values
- `/remote-trigger add <name> <url> [method]` stores a reusable HTTP trigger that can later be fired from the CLI or by the shared agent
- `/chrome open <url>`, `/chrome search <query>`, and `/chrome review <url>` use the default system browser; they are lightweight local helpers, not a built-in browser engine
- `/issue` and `/pr-comments` use the current workspace Git remote. For private repositories, set `GITHUB_TOKEN` or run `gh auth login` first
- `/magic-docs` scans local markdown/text docs under the workspace and is useful before falling back to public web search

Local MCP smoke server for testing:

```bash
npm run mcp:smoke-server
```

Desktop shell:

```bash
npm run desktop
```

Portable Windows build:

```bash
npm run desktop:dist
```

Build output:

- Portable EXE: `release/RoyCode Studio 0.1.0.exe`
- Unpacked desktop app: `release/win-unpacked/`

You can also use:

- `start-webui.ps1`
- `start-webui.bat`
- `start-cli.ps1`
- `start-cli.bat`
- `start-desktop.ps1`
- `start-desktop.bat`
- `start-desktop-packaged.ps1`
- `start-desktop-packaged.bat`

## Why This Is a Separate App

This source snapshot looks much closer to a sourcemap-derived code dump than a complete, buildable public repository. It is missing the normal packaging and infrastructure needed to run the original internal product directly. Building a clean companion app is a much faster and safer path than trying to force the snapshot itself into a working release.

## Snapshot Takeaways

- `main.tsx` is a large stateful REPL entry point
- `commands.ts` centralizes command registration
- `utils/model/*` contains model/provider abstractions
- `bridge/` and `server/` suggest the original tool already had remote or UI-oriented architecture
- `replLauncher.tsx` and related UI files show a React/Ink style terminal interface rather than a minimal readline shell

## References

- DeepSeek docs: <https://api-docs.deepseek.com/>
- MiniMax OpenAI-compatible API docs: <https://platform.minimaxi.com/docs/api-reference/text-openai-api>
