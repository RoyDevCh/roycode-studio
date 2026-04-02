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
```

### Local settings file

Settings live in:

- `data/settings.json`

Important keys:

- `providers`
- `selectedProviderId`
- `selectedModel`
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
```

## 6. Core Prompt Workflow

Plain text input sends a normal prompt to the current model.

Useful prompt helpers:

```bash
/review [task]
/fix [task]
/plan [task]
/explain [topic]
/multiline
```

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
/cwd <path>
/attach <path>
/attachments
```

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
/mcp tools <server>
/mcp prompts <server>
/mcp resources <server>
/mcp call <server> <tool> [json]
```

## 14. Teams, Tasks, and Cron

### Teams

```bash
/teams
/team create <name> [member,member,...]
/team message <team> <from> <to|all> <text>
/team inbox <team> [member]
/team clear-inbox <team> [member]
/team memory <team> [show|set|append|sync] [text]
/team run <name> <prompt>
/team task <name> <prompt>
```

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

## 18. Settings Sync and Remote Triggers

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

## 19. TUI Shortcuts

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

## 20. Desktop and WebUI Notes

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
