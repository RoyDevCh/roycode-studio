# RoyCode User Manual

## 1. What RoyCode Is

RoyCode is a local AI coding workspace inspired by Claude Code. It has four main surfaces:

- `roycode`: the default terminal-first TUI launcher
- `roycode --plain`: the direct line-based CLI
- WebUI: browser app backed by the local Express server
- Desktop app: Electron shell around the same local backend

The CLI/TUI is the most complete surface and is the closest to the Claude Code style workflow.

## 2. Install and First Run

### Prerequisites

- Windows is the primary tested target
- Node.js and npm must already be installed
- Git is recommended

### Source install

```bash
git clone https://github.com/RoyDevCh/roycode-studio.git
cd roycode-studio
npm install
npm run build
```

### Install the global terminal command

```bash
npm run install:command
roycode
roycode-full
```

### Start modes

```bash
roycode
roycode --plain
roycode-full
npm run start
npm run desktop
```

## 3. Core Modes

### `roycode`

Launches the Ink-style TUI. This is the best default choice when working in a terminal.

### `roycode --plain`

Launches the line-based CLI without the TUI wrapper.

### `roycode-full`

Starts in the most permissive local mode:

- unrestricted filesystem access
- safe-write disabled

This is still limited by your Windows user account permissions.

## 4. Configure Models

RoyCode supports:

- DeepSeek
- MiniMax
- custom OpenAI-compatible APIs

### WebUI/Desktop configuration

1. Start the WebUI or desktop app.
2. Open the `Models` panel.
3. Add or edit a provider.
4. Fill in:
   - `Base URL`
   - `API Key`
   - `Models`
   - `Default Model`
5. Save and select the provider/model.

### CLI model switching

```bash
/providers
/provider <id-or-name>
/models
/model <model-name>
/effort [auto|low|medium|high|max]
```

`/effort` controls the local reasoning budget RoyCode uses when it builds runtime prompt policy and agent step limits. `auto` keeps the default behavior.

### Local settings file

Settings live in:

- `data/settings.json`

Important keys:

- `providers`
- `selectedProviderId`
- `selectedModel`
- `effortLevel`
- `accessMode`
- `safeWriteMode`
- `promptSuggestionEnabled`
- `notificationsEnabled`
- `sleepGuardMode`
- `advisorModel`

## 5. Permission Model

RoyCode has three practical permission levels:

- `workspace`: only the current workspace root
- `safe`: unrestricted filesystem, but write approval stays on
- `full`: unrestricted filesystem and direct writes

CLI commands:

```bash
/permissions workspace
/permissions safe
/permissions full
/safe-write on
/safe-write off
/add-dir <path>
```

`/add-dir` lets you keep `workspace` mode while allowing extra absolute directories. This is the closest local analogue to the source snapshot's extra working-directory flow.

## 6. Core Prompt Workflow

Plain text input sends a normal prompt to the current model.

Useful prompt helpers:

```bash
/review [task]
/security-review [task]
/fix [task]
/plan [task]
/explain [topic]
/multiline
```

`/security-review` is the stricter review variant. It biases the model toward vulnerabilities, risky shell/file behavior, missing validation, and behavior regressions.

When prompt suggestions are enabled:

```bash
/suggest
/suggest run 1
/suggest off
```

## 7. Sessions and Transcript Control

### Basic session commands

```bash
/status
/session info
/title <text>
/rename <text>
/new
/sessions
/resume <id|latest>
/delete-session <id|latest|current>
```

### Conversation workflow

```bash
/branch [title]
/summary [instructions]
/thinkback
/insights
/compact [instructions]
/rewind [turns]
/export [path|clipboard]
```

## 8. Files, Search, and Shell

```bash
/files [path] [depth]
/read <path>
/search <query>
/run <command>
/env
/env set <KEY> <VALUE>
/env get <KEY>
/env unset <KEY>
/cwd <path>
/attach <path>
/attachments
```

`/env` stores shell environment overrides in local settings. RoyCode injects them into shell commands and shell-backed agent tools.

## 9. Web Search and Browser Helpers

### Built-in web tools

```bash
/web-search <query>
/web-fetch <url>
```

### Local browser helpers

```bash
/chrome open <url>
/chrome search <query>
/chrome review <url>
```

`/chrome review` fetches readable page text into the terminal instead of opening a browser tab.

## 10. Git and Pending Changes

### Git

```bash
/git
/git diff <path>
/git stage [path]
/git unstage <path>
/git commit <message>
```

### Pending changes

```bash
/pending
/apply <path|all>
/reject <path|all>
```

If safe-write is enabled, edits are staged first and need approval before being written.

## 11. Worktrees, Plan Mode, and Notebook Editing

### Worktrees

```bash
/worktree
/worktree show <ref>
/worktree add <path> [branch] [base]
/worktree switch <ref>
/worktree remove <path> [--force]
/teleport worktree <name|path>
```

### Plan mode

```bash
/plan-mode enter [focus]
/plan-mode status
/plan-mode exit
```

In plan mode, mutating commands are blocked.

### Notebook editing

```bash
/notebook cells <path>
/notebook read <path> <index|id>
/notebook set <path> <index|id> <content>
/notebook add <path> <code|markdown|raw> <content>
/notebook delete <path> <index|id>
```

## 12. LSP and Code Intelligence

RoyCode currently supports a local TypeScript/JavaScript LSP subset.

```bash
/lsp diagnostics <path>
/lsp defs <path> <line> <column>
/lsp impl <path> <line> <column>
/lsp refs <path> <line> <column>
/lsp rename-preview <path> <line> <column> [newName]
/lsp rename-apply <path> <line> <column> <newName>
/lsp hover <path> <line> <column>
/lsp symbols <path>
/lsp workspace-symbols <query>
```

## 13. Skills, Commands, Agents, Plugins, and MCP

### Skills

```bash
/skills
/skill use <name>
/skill drop <name|all>
/skill show <name>
/skill import <path> [name]
```

### Claude-style command compatibility

```bash
/commands
/commands show <name>
/<local-command-name>
```

### Agents

```bash
/agents
/agent show <name>
/agent run <name> <prompt>
```

### Plugins

```bash
/plugins
/plugin import <path> [name]
/plugin commands [plugin]
/plugin run <name> [args]
```

### MCP

```bash
/mcp
/mcp add-stdio <name> <command> [args...]
/mcp add-http <name> <url>
/mcp inspect <server>
/mcp set-header <server> <key> <value>
/mcp unset-header <server> <key>
/mcp set-env <server> <key> <value>
/mcp unset-env <server> <key>
/mcp bearer <server> <token>
/mcp tools <server>
/mcp prompts <server>
/mcp resources <server>
/mcp call <server> <tool> [json]
```

`/mcp inspect` shows the effective configuration RoyCode will use after project `.mcp.json` discovery and saved local overrides are merged.

## 14. Teams, Tasks, and Cron

### Teams

```bash
/teams
/team create <name> [member,member,...]
/team message <team> <from> <to|all> <text>
/team inbox <team> [member]
/team clear-inbox <team> [member]
/team memory <team> [show|set|append|sync|scan] [text]
/team run <name> <prompt>
/team task <name> <prompt>
```

Team memory writes now run a high-confidence secret scan before saving. If RoyCode detects likely API keys or tokens, it blocks the write unless you retry with `--force`.

### Background tasks

```bash
/tasks
/task start <prompt>
/task show <id>
/task logs <id>
/task output <id>
/task stop <id>
/task retry <id>
/task update <id> <prompt>
```

### Scheduled prompts

```bash
/cron
/cron add "<cron>" "<prompt>" [--once]
/cron remove <id>
/cron run-due
```

## 15. Memory, Rules, Output Styles, and Config

```bash
/context
/ctx-viz
/doctor
/instructions
/memory
/memory set <text>
/memory append <text>
/memory extract [instructions]
/rules
/rules all
/output-style
/output-style <name>
/config
/config get <key>
/config set <key> <value>
/agent-memory show <agent> [scope]
/agent-memory set <agent> <scope> <text>
/todos
```

`/ctx-viz` is a direct alias for `/context`.

## 16. Usage, Cost, and Advisor

### Local usage and cost summary

```bash
/usage [today|7d|30d|days]
/cost [today|7d|30d|days]
/stats
```

These are local runtime summaries built from `data/usage.json`. They are useful for:

- recent run counts
- estimated tokens
- rough cost estimates where pricing is known
- recent run duration and tool usage
- top local tool-call counts across the selected window

### Advisor model

```bash
/advisor <model>
/advisor status
/advisor review [text]
/advisor off
```

The advisor model acts as a second-opinion pass. It is local to your current RoyCode settings and uses your configured provider backend.

## 17. Voice, Notifications, and Sleep Guard

### Voice

```bash
/voice status
/voice on
/voice off
/voice say <text>
/voice listen [seconds]
/voice prompt [seconds]
```

Current local implementation:

- Windows text-to-speech output
- Windows speech-to-text one-shot capture

### Notifications

```bash
/notifications status
/notifications on
/notifications off
/notifications test [text]
/notify <text>
```

### Sleep guard

```bash
/sleep-guard status
/sleep-guard on
/sleep-guard off
```

Sleep guard is a local Windows helper that keeps the machine awake during long-running workflows.

## 18. Runtime and Install Inspection

```bash
/version
/release-notes [count]
/upgrade status
/upgrade run
/color [auto|on|off|test]
/terminal-setup
/desktop
```

Use these commands when you want to inspect the installed build, read recent local repo changes, or refresh the checkout in place. `/upgrade run` pulls the current branch, refreshes npm dependencies, and re-installs the global `roycode` launcher.

## 19. Settings Sync and Remote Triggers

### Settings sync

```bash
/settings-sync
/settings-sync export <path> [--redact-secrets]
/settings-sync import <path>
```

Use `--redact-secrets` before moving bundles to another machine or sharing them.

### Remote triggers

```bash
/remote-trigger
/remote-trigger add <name> <url> [POST|PUT] [token]
/remote-trigger run <name> [json]
/remote-trigger enable <name>
/remote-trigger disable <name>
/remote-trigger remove <name>
```

## 20. TUI Shortcuts

In the default `roycode` TUI:

- `Ctrl+R`: `/status`
- `Ctrl+W`: `/context`
- `Ctrl+G`: `/git`
- `Ctrl+P`: `/pending`
- `Ctrl+J`: `/suggest`
- `Ctrl+Y`: `/cron`
- `Ctrl+K`: `/worktree`
- `Ctrl+O`: `/plan-mode status`
- `Ctrl+B`: `/brief toggle`
- `Ctrl+I`: `/thinkback`
- `Ctrl+S`: `/summary`
- `Ctrl+L`: clear local TUI view
- `Ctrl+C`: exit

## 21. Desktop and WebUI Notes

The WebUI and desktop app reuse the same backend and local data store.

Useful entry points:

```bash
npm run start
npm run desktop
npm run desktop:dist
```

The WebUI is great for:

- file browsing and editing
- diff review
- multi-session chat
- terminal panel work

The CLI/TUI is still the most complete Claude-style surface.

## 21. Troubleshooting

### `roycode` not found

- reopen the terminal after `npm run install:command`
- verify Node/npm global bin is in PATH

### provider not found / model errors

- check `data/settings.json`
- verify API key, base URL, enabled flag, and model name

### no browser review output

- try `/web-fetch <url>` for direct page extraction
- some sites block scraping or return anti-bot pages

### no voice input/output

- current local voice features are Windows-only
- speech recognition also depends on a working default microphone and Windows speech components

### no MCP tools appearing

- verify saved MCP server config
- confirm `.mcp.json` is in the project root
- use `/doctor` and `/mcp` to inspect runtime state

### unsafe writes or permission confusion

- use `/permissions`
- use `/safe-write on`
- check `/status`
