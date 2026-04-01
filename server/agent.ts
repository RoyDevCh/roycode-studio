import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import {
  buildFileTree,
  runWorkspaceCommand,
  searchWorkspace,
} from './filesystem.js'
import { getTask, listTasks, createTask, launchTaskRunner } from './tasks.js'
import {
  buildActiveSkillSystemMessage,
  buildLocalSkillPrompt,
  getLocalSkill,
  listLocalSkills,
  type LocalSkillDocument,
} from './skills.js'
import {
  buildPluginCommandPrompt,
  getPluginCommand,
  listInstalledPlugins,
  listPluginCommands,
  type PluginCommandDocument,
} from './pluginRuntime.js'
import {
  fetchBridgeContext,
  listBridges,
  pingBridge,
  runBridgeCommand,
} from './bridges.js'
import {
  buildLocalCompatCommandPrompt,
  getLocalCompatCommand,
  listLocalCompatCommands,
  type LocalCommandDocument,
} from './localCommands.js'
import {
  getLspDefinitions,
  getLspDiagnostics,
  getLspDocumentSymbols,
  getLspHover,
  getLspImplementations,
  getLspRenamePreview,
  getLspReferences,
  getLspWorkspaceSymbols,
} from './lsp.js'
import {
  installMarketplaceItem,
  listMarketplaceItems,
} from './marketplace.js'
import {
  getLocalAgent,
  listLocalAgents,
  type LocalAgentDefinition,
} from './localAgents.js'
import {
  callMcpTool,
  getMcpPrompt,
  listMcpPrompts,
  listMcpResources,
  listMcpServers,
  listMcpTools,
  readMcpResource,
} from './mcp.js'
import {
  getApplicableRules,
  listLocalRules,
  readAgentMemory,
} from './claudeCompat.js'
import { getOutputStyleConfig, listAvailableOutputStyles } from './outputStyles.js'
import {
  getCompatConfigValue,
  listSupportedConfigEntries,
  setCompatConfigValue,
} from './configCompat.js'
import { buildEffectiveSystemPrompt } from './systemPrompt.js'
import { webFetch, webSearch } from './web.js'
import {
  commitWorkspaceChange,
  getWorkspaceFilePayload,
  stagePendingChange,
} from './pendingChanges.js'
import { writeSettings } from './store.js'
import {
  addNotebookCell,
  deleteNotebookCell,
  listNotebookCells,
  readNotebookCell,
  setNotebookCellSource,
} from './notebooks.js'
import {
  createTeam,
  getTeam,
  listTeams,
} from './teams.js'
import { readSessionTodos, writeSessionTodos } from './todos.js'
import {
  addGitWorktree,
  inspectGitWorktree,
  listGitWorktrees,
  removeGitWorktree,
} from './worktrees.js'
import type {
  AgentContentPart,
  AgentStreamEvent,
  AgentToolEvent,
  AppSettings,
  ChatRequest,
  ChatResponse,
  ProviderConfig,
  TodoItem,
} from './types.js'

type AgentCallbacks = {
  onEvent?: (event: AgentStreamEvent) => void | Promise<void>
}

type ToolCallAccumulator = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type FunctionToolDefinition = Extract<
  OpenAI.Chat.Completions.ChatCompletionTool,
  { type: 'function' }
>

const TOOL_DEFINITIONS: FunctionToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories under a workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside the workspace.' },
          depth: {
            type: 'number',
            description: 'Directory recursion depth, 0-4.',
            default: 2,
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a full UTF-8 text file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: { type: 'string', description: 'New file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace a snippet in a file, optionally all occurrences.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          search: { type: 'string', description: 'Exact text to search.' },
          replace: { type: 'string', description: 'Replacement text.' },
          replaceAll: {
            type: 'boolean',
            description: 'Replace every occurrence.',
            default: false,
          },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search plain text across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive text query.' },
          path: {
            type: 'string',
            description: 'Optional relative directory path.',
            default: '.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum matches to return.',
            default: 20,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command inside the workspace for inspection or build tasks.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command text.' },
          cwd: {
            type: 'string',
            description: 'Optional relative working directory.',
            default: '.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout in milliseconds.',
            default: 20000,
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web for current information and documentation. Use allowed_domains when the user wants official docs or a specific site.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text.' },
          allowed_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional allowlist of domains.',
          },
          blocked_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional denylist of domains.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum results to return, 1-8.',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch and extract readable text from a public web page URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to fetch.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tool_search',
      description: 'Search RoyCode tools by name or description to discover available capabilities.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional search text. Omit to list all tools.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: 'List Claude-style rule documents available for the current workspace and cwd.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_rule',
      description: 'Read one Claude-style rule document by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Rule name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_output_styles',
      description: 'List built-in and Claude-compatible output styles available to RoyCode.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_config',
      description: 'Read one RoyCode configuration setting by key.',
      parameters: {
        type: 'object',
        properties: {
          setting: { type: 'string', description: 'Config key such as outputStyle or permissions.defaultMode.' },
        },
        required: ['setting'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_config',
      description: 'Update one RoyCode configuration setting by key.',
      parameters: {
        type: 'object',
        properties: {
          setting: { type: 'string', description: 'Config key such as outputStyle or permissions.defaultMode.' },
          value: {
            description: 'New value for the setting.',
            anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
          },
        },
        required: ['setting', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_todos',
      description: 'Read the current RoyCode session todo list.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Replace the RoyCode session todo list with a new ordered checklist.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                },
                note: { type: 'string' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user_question',
      description:
        'Record that more human input is needed. In this local runtime, the tool returns a structured question so the assistant can ask the user directly.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question that should be shown to the user.' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional suggested options for the user.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List local skills available in this RoyCode workspace.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description: 'Read the full content of one local skill by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Local skill name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_commands',
      description: 'List local Claude-style slash commands available in this workspace.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_command',
      description: 'Read one local Claude-style slash command document by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Local command name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: 'List local Claude-style subagents available in the current workspace.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_agent',
      description: 'Read one local Claude-style subagent definition by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill',
      description:
        'Invoke a Claude-style local skill or slash command. Use this when a known workflow or "/something" command matches the user request.',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: 'Skill or slash-command name, for example verify or plugin-name:command.',
          },
          args: {
            type: 'string',
            description: 'Optional raw argument string passed to the skill.',
          },
        },
        required: ['skill'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'present_files',
      description:
        'Read and bundle several files into one structured response for review or skill workflows.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative or absolute file paths to present.',
          },
          maxCharsPerFile: {
            type: 'number',
            description: 'Maximum characters returned per file.',
            default: 12000,
          },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_subagent',
      description:
        'Run an isolated subagent on a focused prompt and return its result. Use for isolated analysis or execution.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The focused task for the subagent.' },
          model: {
            type: 'string',
            description: 'Optional model override for the subagent.',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory for the subagent.',
            default: '.',
          },
          agent_name: {
            type: 'string',
            description: 'Optional local subagent name loaded from .claude/agents or ~/.claude/agents.',
          },
          system_addenda: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional extra isolated system instructions.',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List durable local background tasks already tracked by RoyCode.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task',
      description: 'Read one RoyCode background task by id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id or prefix.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a background RoyCode task for multi-step work that should continue asynchronously.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title.' },
          prompt: { type: 'string', description: 'Detailed task prompt.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_plugins',
      description: 'List locally installed RoyCode plugins and whether they are enabled.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_plugin_commands',
      description: 'List markdown plugin commands available from local RoyCode plugins.',
      parameters: {
        type: 'object',
        properties: {
          plugin: { type: 'string', description: 'Optional plugin name filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_plugin_command',
      description: 'Read one local plugin command document by full name or short name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plugin command name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_servers',
      description: 'List user-configured local MCP servers available to RoyCode.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_tools',
      description: 'List tools exposed by one configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
        },
        required: ['server'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_mcp_tool',
      description: 'Call one tool exposed by a configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
          tool: { type: 'string', description: 'MCP tool name.' },
          arguments: {
            type: 'object',
            description: 'JSON object arguments passed to the MCP tool.',
            additionalProperties: true,
          },
        },
        required: ['server', 'tool'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_prompts',
      description: 'List prompts exposed by one configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
        },
        required: ['server'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_mcp_prompt',
      description: 'Resolve one prompt exposed by a configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
          prompt: { type: 'string', description: 'MCP prompt name.' },
          arguments: {
            type: 'object',
            description: 'Optional string arguments for the prompt.',
            additionalProperties: {
              type: 'string',
            },
          },
        },
        required: ['server', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_resources',
      description: 'List resources exposed by one configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
        },
        required: ['server'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_mcp_resource',
      description: 'Read one resource exposed by a configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Configured MCP server name.' },
          uri: { type: 'string', description: 'Absolute MCP resource URI.' },
        },
        required: ['server', 'uri'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_worktrees',
      description: 'List git worktrees visible from the current workspace.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_worktree',
      description: 'Create a git worktree at a target path, optionally on a branch.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative target path for the worktree.' },
          branch: { type: 'string', description: 'Optional branch name to use or create.' },
          createBranch: { type: 'boolean', description: 'Create the branch before attaching the worktree.' },
          base: { type: 'string', description: 'Optional base ref such as main or HEAD.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_worktree',
      description: 'Remove a git worktree by path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative worktree path.' },
          force: { type: 'boolean', default: false },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_worktree',
      description: 'Inspect one git worktree by path or branch name.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Worktree path or branch name.' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notebook_cells',
      description: 'List notebook cells in a .ipynb file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook path.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_notebook_cell',
      description: 'Read one notebook cell by index or id.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook path.' },
          cell: { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'Cell index or id.' },
        },
        required: ['path', 'cell'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_notebook_cell',
      description: 'Replace the source of one notebook cell.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook path.' },
          cell: { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'Cell index or id.' },
          content: { type: 'string', description: 'New cell source.' },
        },
        required: ['path', 'cell', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_notebook_cell',
      description: 'Insert a new notebook cell.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook path.' },
          type: { type: 'string', enum: ['code', 'markdown', 'raw'] },
          content: { type: 'string', description: 'Cell source.' },
          index: { type: 'number', description: 'Optional insertion index.' },
        },
        required: ['path', 'type', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_notebook_cell',
      description: 'Delete a notebook cell by index or id.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook path.' },
          cell: { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'Cell index or id.' },
        },
        required: ['path', 'cell'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_teams',
      description: 'List local RoyCode teams used for multi-agent collaboration.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team',
      description: 'Read one local team definition by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_team',
      description: 'Create a local RoyCode team with named members.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team name.' },
          description: { type: 'string' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                agentName: { type: 'string' },
                rolePrompt: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_team',
      description: 'Run every member of a local RoyCode team against the same focused task.',
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Team name.' },
          prompt: { type: 'string', description: 'Shared task prompt.' },
        },
        required: ['team', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_team_tasks',
      description: 'Create one background RoyCode task per member of a local team.',
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Team name.' },
          prompt: { type: 'string', description: 'Shared task prompt.' },
        },
        required: ['team', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_bridges',
      description: 'List configured remote RoyCode bridge endpoints.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ping_bridge',
      description: 'Ping a configured RoyCode bridge endpoint.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bridge name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bridge_context',
      description: 'Fetch health and settings from a configured RoyCode bridge endpoint.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bridge name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bridge_run_command',
      description: 'Run a shell command through a configured RoyCode bridge endpoint.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bridge name.' },
          command: { type: 'string', description: 'Command text.' },
          cwd: { type: 'string', description: 'Optional remote working directory.' },
        },
        required: ['name', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_marketplace_items',
      description: 'List locally configured self-hosted marketplace items.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_marketplace_item',
      description: 'Install a configured marketplace item into RoyCode.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Marketplace item name.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_diagnostics',
      description: 'Get TypeScript or JavaScript diagnostics for one file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'TS/JS file path.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_definition',
      description: 'Resolve definition locations at one file position.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_implementation',
      description: 'Resolve implementation locations at one file position.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_references',
      description: 'Find references at one file position.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_rename_preview',
      description: 'Preview rename locations for one symbol and optionally include a target new name.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' },
          newName: { type: 'string' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_hover',
      description: 'Read quick info / hover details at one file position.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_symbols',
      description: 'List document symbols for one file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_workspace_symbols',
      description: 'Search workspace symbols by text query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: {
            type: 'string',
            description: 'Optional file path used to anchor the workspace language service.',
          },
        },
        required: ['query'],
      },
    },
  },
]

function buildAvailableToolDefinitions(
  request: ChatRequest,
): FunctionToolDefinition[] {
  const allowed = request.allowedTools?.length
    ? new Set(request.allowedTools.map(item => item.trim()).filter(Boolean))
    : null
  const disallowed = request.disallowedTools?.length
    ? new Set(request.disallowedTools.map(item => item.trim()).filter(Boolean))
    : null

  return TOOL_DEFINITIONS.filter(tool => {
    const toolName = tool.function.name
    if (allowed && !allowed.has(toolName)) {
      return false
    }
    if (disallowed && disallowed.has(toolName)) {
      return false
    }
    return true
  })
}

function sanitizeToolOutput(output: string): string {
  return output.length > 6000 ? `${output.slice(0, 6000)}\n...[truncated]` : output
}

function createCompatSessionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function resolveTodoSessionId(request: ChatRequest, workspaceRoot: string): string {
  return request.sessionId?.trim() || `workspace:${workspaceRoot}`
}

function normalizeTodoList(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    throw new Error('todos must be an array')
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Todo at index ${index} must be an object`)
    }
    const content = String((item as Record<string, unknown>).content ?? '').trim()
    const status = String((item as Record<string, unknown>).status ?? '').trim()
    const note = String((item as Record<string, unknown>).note ?? '').trim()
    if (!content) {
      throw new Error(`Todo at index ${index} is missing content`)
    }
    if (!['pending', 'in_progress', 'completed'].includes(status)) {
      throw new Error(
        `Todo "${content}" must use status pending, in_progress, or completed`,
      )
    }
    return {
      content,
      status: status as TodoItem['status'],
      note: note || undefined,
    }
  })
}

async function runSubagentPrompt(
  provider: ProviderConfig,
  settings: AppSettings,
  request: ChatRequest,
  prompt: string,
  options?: {
    agentDefinition?: LocalAgentDefinition
    modelOverride?: string
    cwdOverride?: string
    systemAddenda?: string[]
  },
): Promise<ChatResponse> {
  const targetCwd = options?.cwdOverride || request.cwd || '.'
  const agentMemory = options?.agentDefinition?.memory
    ? await readAgentMemory(
        options.agentDefinition.name,
        options.agentDefinition.memory,
        settings.workspaceRoot,
        targetCwd,
      )
    : null
  const agentSkillMessage = options?.agentDefinition?.skills?.length
    ? await buildActiveSkillSystemMessage(options.agentDefinition.skills, {
        workspaceRoot: settings.workspaceRoot,
        cwd: targetCwd,
        accessMode: settings.accessMode,
        sessionId: createCompatSessionId('agent-skill'),
      })
    : null

  const agentAddenda = options?.agentDefinition
    ? [
        `You are running as the local subagent "${options.agentDefinition.name}".`,
        `Agent description: ${options.agentDefinition.description}`,
        `Agent prompt:\n${options.agentDefinition.prompt}`,
        ...(options.agentDefinition.permissionMode
          ? [`Requested permission mode: ${options.agentDefinition.permissionMode}`]
          : []),
        ...(options.agentDefinition.memory
          ? [`Requested memory scope: ${options.agentDefinition.memory}`]
          : []),
        ...(options.agentDefinition.isolation
          ? [`Requested isolation mode: ${options.agentDefinition.isolation}`]
          : []),
        ...(agentMemory?.content
          ? [
              `Agent memory (${agentMemory.scope}) from ${agentMemory.path}:\n${agentMemory.content}`,
            ]
          : []),
        ...(agentSkillMessage ? [agentSkillMessage] : []),
      ]
    : []

  const composedPrompt = options?.agentDefinition?.initialPrompt
    ? `${options.agentDefinition.initialPrompt}\n\n${prompt}`
    : prompt

  return runAgentChatInternal(provider, settings, {
    providerId: request.providerId,
    model: options?.modelOverride || options?.agentDefinition?.model || request.model,
    cwd: targetCwd,
    systemAddenda: [
      ...(request.systemAddenda ?? []),
      'You are running in an isolated subagent execution context. Complete the focused task and return only the result needed by the parent agent.',
      ...agentAddenda,
      ...(options?.systemAddenda ?? []),
    ],
    allowedTools: options?.agentDefinition?.tools,
    disallowedTools: options?.agentDefinition?.disallowedTools,
    maxAgentSteps: options?.agentDefinition?.maxTurns,
    messages: [
      {
        role: 'user',
        content: composedPrompt,
      },
    ],
  })
}

function formatInlineSkillResult(
  document: LocalSkillDocument | PluginCommandDocument | LocalCommandDocument,
  prompt: string,
): string {
  return JSON.stringify(
    {
      success: true,
      commandName: document.name,
      status: 'inline',
      model: document.model,
      allowedTools: document.allowedTools,
      sourcePath: document.filePath,
      loadedPrompt: prompt,
      instructions:
        'Treat loadedPrompt as the active skill/command instructions for the current task and follow it before answering.',
    },
    null,
    2,
  )
}

async function emitEvent(
  callbacks: AgentCallbacks | undefined,
  event: AgentStreamEvent,
): Promise<void> {
  if (callbacks?.onEvent) {
    await callbacks.onEvent(event)
  }
}

function extractTextContent(content: string | AgentContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((part): part is Extract<AgentContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

function toOpenAIUserContent(
  content: string | AgentContentPart[],
):
  | string
  | Array<
      | OpenAI.Chat.Completions.ChatCompletionContentPartText
      | OpenAI.Chat.Completions.ChatCompletionContentPartImage
    > {
  if (typeof content === 'string') {
    return content
  }

  const parts: Array<
    | OpenAI.Chat.Completions.ChatCompletionContentPartText
    | OpenAI.Chat.Completions.ChatCompletionContentPartImage
  > = []

  for (const part of content) {
    if (part.type === 'text') {
      if (part.text.trim()) {
        parts.push({
          type: 'text',
          text: part.text,
        })
      }
      continue
    }

    if (!part.imageUrl) {
      continue
    }

    parts.push({
      type: 'image_url',
      image_url: {
        url: part.imageUrl,
        detail: part.detail ?? 'auto',
      },
    })
  }

  return parts.length ? parts : ''
}

async function executeTool(
  provider: ProviderConfig,
  workspaceRoot: string,
  toolName: string,
  input: Record<string, unknown>,
  settings: AppSettings,
  request: ChatRequest,
): Promise<string> {
  const accessMode = settings.accessMode

  switch (toolName) {
    case 'list_files': {
      const tree = await buildFileTree(
        workspaceRoot,
        String(input.path ?? '.'),
        Math.min(Number(input.depth ?? 2), 4),
        accessMode,
      )
      return JSON.stringify(tree, null, 2)
    }
    case 'read_file': {
      const file = await getWorkspaceFilePayload(
        workspaceRoot,
        String(input.path ?? ''),
        accessMode,
      )
      return file.content
    }
    case 'write_file': {
      const targetPath = String(input.path ?? '')
      const nextContent = String(input.content ?? '')
      if (settings.safeWriteMode) {
        await stagePendingChange({
          workspaceRoot,
          path: targetPath,
          content: nextContent,
          source: 'agent',
          accessMode,
        })
      } else {
        await commitWorkspaceChange({
          workspaceRoot,
          path: targetPath,
          content: nextContent,
          accessMode,
        })
      }
      return settings.safeWriteMode
        ? `Staged pending change for ${targetPath}`
        : `Updated ${targetPath}`
    }
    case 'replace_in_file': {
      const targetPath = String(input.path ?? '')
      const currentFile = await getWorkspaceFilePayload(
        workspaceRoot,
        targetPath,
        accessMode,
      )
      const searchValue = String(input.search ?? '')
      const replaceValue = String(input.replace ?? '')
      if (!currentFile.content.includes(searchValue)) {
        throw new Error('Search text was not found in the target file')
      }
      const updated = Boolean(input.replaceAll)
        ? currentFile.content.split(searchValue).join(replaceValue)
        : currentFile.content.replace(searchValue, replaceValue)
      if (settings.safeWriteMode) {
        await stagePendingChange({
          workspaceRoot,
          path: targetPath,
          content: updated,
          source: 'agent',
          accessMode,
        })
      } else {
        await commitWorkspaceChange({
          workspaceRoot,
          path: targetPath,
          content: updated,
          accessMode,
        })
      }
      return settings.safeWriteMode
        ? `Staged pending change for ${targetPath}`
        : `Updated ${targetPath}`
    }
    case 'search_files': {
      const matches = await searchWorkspace(
        workspaceRoot,
        String(input.query ?? ''),
        String(input.path ?? '.'),
        Number(input.maxResults ?? 20),
        accessMode,
      )
      return JSON.stringify(matches, null, 2)
    }
    case 'run_command': {
      return runWorkspaceCommand(
        workspaceRoot,
        String(input.command ?? ''),
        String(input.cwd ?? '.'),
        Math.min(
          Number(input.timeoutMs ?? settings.commandTimeoutMs),
          settings.commandTimeoutMs,
        ),
        accessMode,
      )
    }
    case 'web_search': {
      const results = await webSearch({
        query: String(input.query ?? ''),
        allowedDomains: Array.isArray(input.allowed_domains)
          ? input.allowed_domains.map(item => String(item))
          : undefined,
        blockedDomains: Array.isArray(input.blocked_domains)
          ? input.blocked_domains.map(item => String(item))
          : undefined,
        maxResults: Number(input.maxResults ?? 5),
      })
      return JSON.stringify(results, null, 2)
    }
    case 'web_fetch': {
      const result = await webFetch(String(input.url ?? ''))
      return JSON.stringify(result, null, 2)
    }
    case 'tool_search': {
      const query = String(input.query ?? '').trim().toLowerCase()
      const results = TOOL_DEFINITIONS.filter(tool => {
        if (!query) {
          return true
        }
        return (
          tool.function.name.toLowerCase().includes(query) ||
          (tool.function.description ?? '').toLowerCase().includes(query)
        )
      }).map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
      }))
      return JSON.stringify(results, null, 2)
    }
    case 'list_rules': {
      const rules = await getApplicableRules(workspaceRoot, request.cwd ?? '.')
      return JSON.stringify(rules, null, 2)
    }
    case 'read_rule': {
      const name = String(input.name ?? '').trim()
      const rules = await listLocalRules(workspaceRoot, request.cwd ?? '.')
      const rule =
        rules.find(item => item.name.toLowerCase() === name.toLowerCase()) ??
        rules.find(item => item.name.toLowerCase().startsWith(name.toLowerCase())) ??
        rules.find(item => item.name.toLowerCase().includes(name.toLowerCase()))
      if (!rule) {
        throw new Error(`Rule not found: ${name}`)
      }
      return JSON.stringify(rule, null, 2)
    }
    case 'list_output_styles': {
      const styles = await listAvailableOutputStyles(workspaceRoot, request.cwd ?? '.')
      return JSON.stringify(styles, null, 2)
    }
    case 'get_config': {
      const entry = getCompatConfigValue(settings, String(input.setting ?? ''))
      if (!entry) {
        throw new Error(`Unknown config setting: ${String(input.setting ?? '')}`)
      }
      return JSON.stringify(entry, null, 2)
    }
    case 'set_config': {
      const { entry, previousValue, settings: nextSettings } = setCompatConfigValue(
        settings,
        String(input.setting ?? ''),
        input.value as string | number | boolean,
      )
      Object.assign(settings, nextSettings)
      await writeSettings(nextSettings)
      return JSON.stringify(
        {
          success: true,
          setting: entry.key,
          previousValue,
          newValue: entry.value,
        },
        null,
        2,
      )
    }
    case 'read_todos': {
      const todos = await readSessionTodos(resolveTodoSessionId(request, workspaceRoot))
      return JSON.stringify(todos, null, 2)
    }
    case 'todo_write': {
      const todos = normalizeTodoList(input.todos)
      const next = await writeSessionTodos(resolveTodoSessionId(request, workspaceRoot), todos)
      return JSON.stringify(
        {
          success: true,
          count: next.length,
          todos: next,
        },
        null,
        2,
      )
    }
    case 'ask_user_question': {
      const question = String(input.question ?? '').trim()
      if (!question) {
        throw new Error('Question is required')
      }
      return JSON.stringify(
        {
          success: true,
          interactive: false,
          question,
          options: Array.isArray(input.options)
            ? input.options.map(item => String(item)).filter(Boolean)
            : [],
          instructions:
            'Ask the user this question directly in the next assistant response and wait for their answer.',
        },
        null,
        2,
      )
    }
    case 'list_skills': {
      const skills = await listLocalSkills(workspaceRoot, request.cwd ?? '.')
      return JSON.stringify(skills, null, 2)
    }
    case 'list_commands': {
      const commands = await listLocalCompatCommands(workspaceRoot, request.cwd ?? '.')
      return JSON.stringify(commands, null, 2)
    }
    case 'read_command': {
      const command = await getLocalCompatCommand(
        String(input.name ?? ''),
        workspaceRoot,
        request.cwd ?? '.',
      )
      if (!command) {
        throw new Error(`Command not found: ${String(input.name ?? '')}`)
      }
      return JSON.stringify(command, null, 2)
    }
    case 'read_skill': {
      const skill = await getLocalSkill(
        String(input.name ?? ''),
        workspaceRoot,
        request.cwd ?? '.',
      )
      if (!skill) {
        throw new Error(`Skill not found: ${String(input.name ?? '')}`)
      }
      return JSON.stringify(skill, null, 2)
    }
    case 'list_agents': {
      const agents = await listLocalAgents(workspaceRoot, request.cwd ?? '.')
      return JSON.stringify(agents, null, 2)
    }
    case 'read_agent': {
      const agent = await getLocalAgent(
        String(input.name ?? ''),
        workspaceRoot,
        request.cwd ?? '.',
      )
      if (!agent) {
        throw new Error(`Agent not found: ${String(input.name ?? '')}`)
      }
      return JSON.stringify(agent, null, 2)
    }
    case 'skill': {
      const skillName = String(input.skill ?? '').trim()
      const rawArgs = String(input.args ?? '')
      if (!skillName) {
        throw new Error('Skill name is required')
      }

      const skillPrompt = await buildLocalSkillPrompt(skillName, {
        workspaceRoot,
        cwd: request.cwd ?? '.',
        accessMode,
        sessionId: createCompatSessionId('skill'),
        args: rawArgs,
        executeShell: true,
      })

      if (skillPrompt) {
        const targetAgent = skillPrompt.skill.agent
          ? await getLocalAgent(skillPrompt.skill.agent, workspaceRoot, request.cwd ?? '.')
          : null
        if (skillPrompt.skill.context === 'fork' || skillPrompt.skill.agent) {
          const response = await runSubagentPrompt(
            provider,
            settings,
            request,
            skillPrompt.prompt,
            {
              agentDefinition: targetAgent ?? undefined,
              modelOverride: skillPrompt.skill.model || targetAgent?.model,
              systemAddenda: [
                `This execution was launched from the skill "${skillPrompt.skill.name}".`,
                ...(skillPrompt.skill.agent
                  ? [
                      targetAgent
                        ? `Using local subagent definition: ${targetAgent.name}.`
                        : `Preferred subagent type: ${skillPrompt.skill.agent}.`,
                    ]
                  : []),
              ],
            },
          )
          return JSON.stringify(
            {
              success: true,
              commandName: skillPrompt.skill.name,
              status: 'forked',
              model: response.model,
              result: response.answer,
              toolEvents: response.toolEvents,
            },
            null,
            2,
          )
        }

        return formatInlineSkillResult(skillPrompt.skill, skillPrompt.prompt)
      }

      const localCommandPrompt = await buildLocalCompatCommandPrompt(skillName, {
        workspaceRoot,
        cwd: request.cwd ?? '.',
        accessMode,
        sessionId: createCompatSessionId('command'),
        args: rawArgs,
        executeShell: true,
      })

      if (localCommandPrompt) {
        const targetAgent = localCommandPrompt.command.agent
          ? await getLocalAgent(localCommandPrompt.command.agent, workspaceRoot, request.cwd ?? '.')
          : null
        if (localCommandPrompt.command.context === 'fork' || localCommandPrompt.command.agent) {
          const response = await runSubagentPrompt(
            provider,
            settings,
            request,
            localCommandPrompt.prompt,
            {
              agentDefinition: targetAgent ?? undefined,
              modelOverride: localCommandPrompt.command.model || targetAgent?.model,
              systemAddenda: [
                `This execution was launched from the local command "${localCommandPrompt.command.name}".`,
                ...(localCommandPrompt.command.agent
                  ? [
                      targetAgent
                        ? `Using local subagent definition: ${targetAgent.name}.`
                        : `Preferred subagent type: ${localCommandPrompt.command.agent}.`,
                    ]
                  : []),
              ],
            },
          )
          return JSON.stringify(
            {
              success: true,
              commandName: localCommandPrompt.command.name,
              status: 'forked',
              model: response.model,
              result: response.answer,
              toolEvents: response.toolEvents,
            },
            null,
            2,
          )
        }

        return formatInlineSkillResult(localCommandPrompt.command, localCommandPrompt.prompt)
      }

      const pluginPrompt = await buildPluginCommandPrompt(skillName, rawArgs, {
        workspaceRoot,
        cwd: request.cwd ?? '.',
        accessMode,
        sessionId: createCompatSessionId('command'),
        executeShell: true,
      })

      if (!pluginPrompt) {
        throw new Error(`Skill or slash command not found: ${skillName}`)
      }

      if (pluginPrompt.command.context === 'fork' || pluginPrompt.command.agent) {
        const targetAgent = pluginPrompt.command.agent
          ? await getLocalAgent(pluginPrompt.command.agent, workspaceRoot, request.cwd ?? '.')
          : null
        const response = await runSubagentPrompt(
          provider,
          settings,
          request,
          pluginPrompt.prompt,
          {
            agentDefinition: targetAgent ?? undefined,
            modelOverride: pluginPrompt.command.model || targetAgent?.model,
            systemAddenda: [
              `This execution was launched from the plugin command "${pluginPrompt.command.name}".`,
              ...(pluginPrompt.command.agent
                ? [
                    targetAgent
                      ? `Using local subagent definition: ${targetAgent.name}.`
                      : `Preferred subagent type: ${pluginPrompt.command.agent}.`,
                  ]
                : []),
            ],
          },
        )
        return JSON.stringify(
          {
            success: true,
            commandName: pluginPrompt.command.name,
            status: 'forked',
            model: response.model,
            result: response.answer,
            toolEvents: response.toolEvents,
          },
          null,
          2,
        )
      }

      return formatInlineSkillResult(pluginPrompt.command, pluginPrompt.prompt)
    }
    case 'present_files': {
      const rawPaths = Array.isArray(input.paths) ? input.paths : []
      const paths = rawPaths.map(item => String(item)).filter(Boolean).slice(0, 24)
      if (!paths.length) {
        throw new Error('At least one file path is required')
      }
      const maxCharsPerFile = Math.max(
        1_000,
        Math.min(Number(input.maxCharsPerFile ?? 12_000), 50_000),
      )
      const files = await Promise.all(
        paths.map(async filePath => {
          const file = await getWorkspaceFilePayload(workspaceRoot, filePath, accessMode)
          const truncated = file.content.length > maxCharsPerFile
          return {
            path: filePath,
            truncated,
            content: truncated
              ? `${file.content.slice(0, maxCharsPerFile)}\n...[truncated]`
              : file.content,
          }
        }),
      )
      return JSON.stringify({ files }, null, 2)
    }
    case 'run_subagent': {
      const prompt = String(input.prompt ?? '').trim()
      if (!prompt) {
        throw new Error('Subagent prompt is required')
      }
      const namedAgent = input.agent_name
        ? await getLocalAgent(String(input.agent_name), workspaceRoot, request.cwd ?? '.')
        : null
      if (input.agent_name && !namedAgent) {
        throw new Error(`Agent not found: ${String(input.agent_name)}`)
      }
      const response = await runSubagentPrompt(provider, settings, request, prompt, {
        agentDefinition: namedAgent ?? undefined,
        modelOverride: input.model ? String(input.model) : undefined,
        cwdOverride: input.cwd ? String(input.cwd) : undefined,
        systemAddenda: Array.isArray(input.system_addenda)
          ? input.system_addenda.map(item => String(item))
          : undefined,
      })
      return JSON.stringify(response, null, 2)
    }
    case 'list_tasks': {
      const tasks = await listTasks()
      return JSON.stringify(
        tasks.map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          updatedAt: task.updatedAt,
          workspaceRoot: task.workspaceRoot,
        })),
        null,
        2,
      )
    }
    case 'get_task': {
      const task = await getTask(String(input.id ?? ''))
      if (!task) {
        throw new Error(`Task not found: ${String(input.id ?? '')}`)
      }
      return JSON.stringify(task, null, 2)
    }
    case 'create_task': {
      const task = await createTask({
        title: String(input.title ?? input.prompt ?? '').trim(),
        prompt: String(input.prompt ?? ''),
        workspaceRoot,
        accessMode: settings.accessMode,
        safeWriteMode: settings.safeWriteMode,
        providerId: request.providerId,
        model: request.model,
        cwd: request.cwd ?? '.',
        baseMessages: request.messages.slice(-8),
      })
      launchTaskRunner(task.id)
      return JSON.stringify(
        {
          id: task.id,
          title: task.title,
          status: task.status,
          logPath: task.logPath,
        },
        null,
        2,
      )
    }
    case 'list_plugins': {
      const plugins = await listInstalledPlugins()
      return JSON.stringify(plugins, null, 2)
    }
    case 'list_plugin_commands': {
      const commands = await listPluginCommands(
        input.plugin ? String(input.plugin) : undefined,
      )
      return JSON.stringify(
        commands.map(command => ({
          name: command.name,
          pluginName: command.pluginName,
          description: command.description,
          argumentHint: command.argumentHint,
          whenToUse: command.whenToUse,
          filePath: command.filePath,
        })),
        null,
        2,
      )
    }
    case 'read_plugin_command': {
      const command = await getPluginCommand(String(input.name ?? ''))
      if (!command) {
        throw new Error(`Plugin command not found: ${String(input.name ?? '')}`)
      }
      return JSON.stringify(command, null, 2)
    }
    case 'list_mcp_servers': {
      const servers = await listMcpServers(workspaceRoot)
      return JSON.stringify(servers, null, 2)
    }
    case 'list_mcp_tools': {
      const tools = await listMcpTools(String(input.server ?? ''), workspaceRoot)
      return JSON.stringify(tools, null, 2)
    }
    case 'call_mcp_tool': {
      const result = await callMcpTool(
        String(input.server ?? ''),
        String(input.tool ?? ''),
        typeof input.arguments === 'object' && input.arguments && !Array.isArray(input.arguments)
          ? (input.arguments as Record<string, unknown>)
          : {},
        workspaceRoot,
      )
      return JSON.stringify(result, null, 2)
    }
    case 'list_mcp_prompts': {
      const prompts = await listMcpPrompts(String(input.server ?? ''), workspaceRoot)
      return JSON.stringify(prompts, null, 2)
    }
    case 'get_mcp_prompt': {
      const rawArguments =
        typeof input.arguments === 'object' && input.arguments && !Array.isArray(input.arguments)
          ? (input.arguments as Record<string, unknown>)
          : {}
      const promptArgs = Object.fromEntries(
        Object.entries(rawArguments).map(([key, value]) => [key, String(value)]),
      )
      const result = await getMcpPrompt(
        String(input.server ?? ''),
        String(input.prompt ?? ''),
        promptArgs,
        workspaceRoot,
      )
      return JSON.stringify(result, null, 2)
    }
    case 'list_mcp_resources': {
      const resources = await listMcpResources(String(input.server ?? ''), workspaceRoot)
      return JSON.stringify(resources, null, 2)
    }
    case 'read_mcp_resource': {
      const resource = await readMcpResource(
        String(input.server ?? ''),
        String(input.uri ?? ''),
        workspaceRoot,
      )
      return JSON.stringify(resource, null, 2)
    }
    case 'list_worktrees': {
      const worktrees = await listGitWorktrees(workspaceRoot)
      return JSON.stringify(worktrees, null, 2)
    }
    case 'create_worktree': {
      const worktree = await addGitWorktree({
        workspaceRoot,
        targetPath: String(input.path ?? ''),
        branch: input.branch ? String(input.branch) : undefined,
        createBranch: Boolean(input.createBranch),
        base: input.base ? String(input.base) : undefined,
      })
      return JSON.stringify(worktree, null, 2)
    }
    case 'remove_worktree': {
      await removeGitWorktree(
        workspaceRoot,
        String(input.path ?? ''),
        Boolean(input.force),
      )
      return JSON.stringify({ success: true, path: String(input.path ?? '') }, null, 2)
    }
    case 'inspect_worktree': {
      const worktree = await inspectGitWorktree(workspaceRoot, String(input.reference ?? ''))
      if (!worktree) {
        throw new Error(`Worktree not found: ${String(input.reference ?? '')}`)
      }
      return JSON.stringify(worktree, null, 2)
    }
    case 'list_notebook_cells': {
      const cells = await listNotebookCells(
        workspaceRoot,
        String(input.path ?? ''),
        accessMode,
      )
      return JSON.stringify(cells, null, 2)
    }
    case 'read_notebook_cell': {
      const cell = await readNotebookCell(
        workspaceRoot,
        String(input.path ?? ''),
        typeof input.cell === 'number' ? input.cell : String(input.cell ?? ''),
        accessMode,
      )
      return JSON.stringify(cell, null, 2)
    }
    case 'edit_notebook_cell': {
      const result = await setNotebookCellSource({
        workspaceRoot,
        notebookPath: String(input.path ?? ''),
        reference: typeof input.cell === 'number' ? input.cell : String(input.cell ?? ''),
        newSource: String(input.content ?? ''),
        accessMode,
        safeWriteMode: settings.safeWriteMode,
        source: 'agent',
      })
      return JSON.stringify(result, null, 2)
    }
    case 'add_notebook_cell': {
      const result = await addNotebookCell({
        workspaceRoot,
        notebookPath: String(input.path ?? ''),
        type: String(input.type ?? 'code') as 'code' | 'markdown' | 'raw',
        content: String(input.content ?? ''),
        index:
          typeof input.index === 'number' && Number.isFinite(input.index)
            ? input.index
            : undefined,
        accessMode,
        safeWriteMode: settings.safeWriteMode,
        source: 'agent',
      })
      return JSON.stringify(result, null, 2)
    }
    case 'delete_notebook_cell': {
      const result = await deleteNotebookCell({
        workspaceRoot,
        notebookPath: String(input.path ?? ''),
        reference: typeof input.cell === 'number' ? input.cell : String(input.cell ?? ''),
        accessMode,
        safeWriteMode: settings.safeWriteMode,
        source: 'agent',
      })
      return JSON.stringify(result, null, 2)
    }
    case 'list_teams': {
      const teams = await listTeams()
      return JSON.stringify(teams, null, 2)
    }
    case 'get_team': {
      const team = await getTeam(String(input.name ?? ''))
      if (!team) {
        throw new Error(`Team not found: ${String(input.name ?? '')}`)
      }
      return JSON.stringify(team, null, 2)
    }
    case 'create_team': {
      const team = await createTeam({
        name: String(input.name ?? ''),
        description: input.description ? String(input.description) : undefined,
        members: Array.isArray(input.members)
          ? input.members
              .filter(item => item && typeof item === 'object' && !Array.isArray(item))
              .map(item => {
                const record = item as Record<string, unknown>
                return {
                  name: String(record.name ?? ''),
                  agentName: record.agentName ? String(record.agentName) : undefined,
                  rolePrompt: record.rolePrompt ? String(record.rolePrompt) : undefined,
                }
              })
          : [],
      })
      return JSON.stringify(team, null, 2)
    }
    case 'run_team': {
      const team = await getTeam(String(input.team ?? ''))
      if (!team) {
        throw new Error(`Team not found: ${String(input.team ?? '')}`)
      }
      const memberResults = []
      for (const member of team.members) {
        const localAgent = member.agentName
          ? await getLocalAgent(member.agentName, workspaceRoot, request.cwd ?? '.')
          : null
        const memberPrompt = [
          member.rolePrompt ? `Role: ${member.rolePrompt}` : '',
          `Team: ${team.name}`,
          `Member: ${member.name}`,
          String(input.prompt ?? ''),
        ]
          .filter(Boolean)
          .join('\n\n')
        const result = await runSubagentPrompt(provider, settings, request, memberPrompt, {
          agentDefinition: localAgent ?? undefined,
        })
        memberResults.push({
          member: member.name,
          agent: localAgent?.name ?? member.agentName ?? null,
          answer: result.answer,
          model: result.model,
        })
      }
      return JSON.stringify({ team: team.name, results: memberResults }, null, 2)
    }
    case 'create_team_tasks': {
      const team = await getTeam(String(input.team ?? ''))
      if (!team) {
        throw new Error(`Team not found: ${String(input.team ?? '')}`)
      }
      const createdTasks = []
      for (const member of team.members) {
        const localAgent = member.agentName
          ? await getLocalAgent(member.agentName, workspaceRoot, request.cwd ?? '.')
          : null
        const memberPrompt = [
          member.rolePrompt ? `Role: ${member.rolePrompt}` : '',
          `Team: ${team.name}`,
          `Member: ${member.name}`,
          String(input.prompt ?? ''),
        ]
          .filter(Boolean)
          .join('\n\n')
        const task = await createTask({
          title: `${team.name}:${member.name}`,
          prompt: memberPrompt,
          workspaceRoot,
          accessMode: settings.accessMode,
          safeWriteMode: settings.safeWriteMode,
          providerId: request.providerId,
          model: localAgent?.model || request.model,
          cwd: request.cwd ?? '.',
          baseMessages: request.messages.slice(-6),
        })
        launchTaskRunner(task.id)
        createdTasks.push({
          member: member.name,
          agent: localAgent?.name ?? member.agentName ?? null,
          id: task.id,
          status: task.status,
          logPath: task.logPath,
        })
      }
      return JSON.stringify({ team: team.name, tasks: createdTasks }, null, 2)
    }
    case 'list_bridges': {
      const bridges = await listBridges()
      return JSON.stringify(bridges, null, 2)
    }
    case 'ping_bridge': {
      const result = await pingBridge(String(input.name ?? ''))
      return JSON.stringify(result, null, 2)
    }
    case 'bridge_context': {
      const result = await fetchBridgeContext(String(input.name ?? ''))
      return JSON.stringify(result, null, 2)
    }
    case 'bridge_run_command': {
      const result = await runBridgeCommand({
        reference: String(input.name ?? ''),
        command: String(input.command ?? ''),
        cwd: input.cwd ? String(input.cwd) : undefined,
      })
      return JSON.stringify(result, null, 2)
    }
    case 'list_marketplace_items': {
      const items = await listMarketplaceItems()
      return JSON.stringify(items, null, 2)
    }
    case 'install_marketplace_item': {
      const result = await installMarketplaceItem(String(input.name ?? ''))
      return JSON.stringify(result, null, 2)
    }
    case 'lsp_diagnostics': {
      const diagnostics = await getLspDiagnostics(
        workspaceRoot,
        String(input.path ?? ''),
        accessMode,
      )
      return JSON.stringify(diagnostics, null, 2)
    }
    case 'lsp_definition': {
      const definitions = await getLspDefinitions({
        workspaceRoot,
        filePath: String(input.path ?? ''),
        line: Number(input.line ?? 1),
        column: Number(input.column ?? 1),
        accessMode,
      })
      return JSON.stringify(definitions, null, 2)
    }
    case 'lsp_implementation': {
      const implementations = await getLspImplementations({
        workspaceRoot,
        filePath: String(input.path ?? ''),
        line: Number(input.line ?? 1),
        column: Number(input.column ?? 1),
        accessMode,
      })
      return JSON.stringify(implementations, null, 2)
    }
    case 'lsp_references': {
      const references = await getLspReferences({
        workspaceRoot,
        filePath: String(input.path ?? ''),
        line: Number(input.line ?? 1),
        column: Number(input.column ?? 1),
        accessMode,
      })
      return JSON.stringify(references, null, 2)
    }
    case 'lsp_rename_preview': {
      const preview = await getLspRenamePreview({
        workspaceRoot,
        filePath: String(input.path ?? ''),
        line: Number(input.line ?? 1),
        column: Number(input.column ?? 1),
        accessMode,
        newName: input.newName ? String(input.newName) : undefined,
      })
      return JSON.stringify(preview, null, 2)
    }
    case 'lsp_hover': {
      const hover = await getLspHover({
        workspaceRoot,
        filePath: String(input.path ?? ''),
        line: Number(input.line ?? 1),
        column: Number(input.column ?? 1),
        accessMode,
      })
      return JSON.stringify(hover, null, 2)
    }
    case 'lsp_symbols': {
      const symbols = await getLspDocumentSymbols(
        workspaceRoot,
        String(input.path ?? ''),
        accessMode,
      )
      return JSON.stringify(symbols, null, 2)
    }
    case 'lsp_workspace_symbols': {
      const symbols = await getLspWorkspaceSymbols({
        workspaceRoot,
        filePath: input.path ? String(input.path) : undefined,
        query: String(input.query ?? ''),
        accessMode,
      })
      return JSON.stringify(symbols, null, 2)
    }
    default:
      throw new Error(`Unsupported tool: ${toolName}`)
  }
}

async function collectStreamingAssistantTurn(
  client: OpenAI,
  model: string,
  conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[],
  callbacks?: AgentCallbacks,
): Promise<{
  text: string
  toolCalls: ToolCallAccumulator[]
}> {
  const stream = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: conversation,
    ...(toolDefinitions.length
      ? {
          tools: toolDefinitions,
          tool_choice: 'auto' as const,
        }
      : {}),
    stream: true,
  })

  let text = ''
  const toolCalls: ToolCallAccumulator[] = []

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) {
      continue
    }

    const deltaContent = choice.delta.content
    if (typeof deltaContent === 'string' && deltaContent.length > 0) {
      text += deltaContent
      await emitEvent(callbacks, {
        type: 'text-delta',
        delta: deltaContent,
      })
    }

    for (const partialToolCall of choice.delta.tool_calls ?? []) {
      const index = partialToolCall.index ?? 0
      if (!toolCalls[index]) {
        toolCalls[index] = {
          id: partialToolCall.id ?? `tool-${index}`,
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        }
      }

      const current = toolCalls[index]!
      if (partialToolCall.id) {
        current.id = partialToolCall.id
      }
      if (partialToolCall.function?.name) {
        current.function.name += partialToolCall.function.name
      }
      if (partialToolCall.function?.arguments) {
        current.function.arguments += partialToolCall.function.arguments
      }
    }
  }

  return { text, toolCalls }
}

async function runAgentChatInternal(
  provider: ProviderConfig,
  settings: AppSettings,
  request: ChatRequest,
  callbacks?: AgentCallbacks,
): Promise<ChatResponse> {
  if (!provider.apiKey) {
    throw new Error(`Provider "${provider.name}" is missing an API key`)
  }

  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl,
  })

  const workspaceRoot = settings.workspaceRoot
  const systemPrompt = await buildEffectiveSystemPrompt(settings, request)
  const availableToolDefinitions = buildAvailableToolDefinitions(request)

  const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }]

  for (const message of request.messages) {
    if (message.role === 'user') {
      conversation.push({
        role: 'user',
        content: toOpenAIUserContent(message.content),
      })
      continue
    }

    conversation.push({
      role: message.role,
      content: extractTextContent(message.content),
    })
  }

  const toolEvents: AgentToolEvent[] = []

  const maxSteps = Math.min(
    request.maxAgentSteps ?? settings.maxAgentSteps,
    settings.maxAgentSteps,
  )

  for (let step = 0; step < maxSteps; step += 1) {
    await emitEvent(callbacks, {
      type: 'status',
      message: `Running agent step ${step + 1}...`,
    })

    const assistantTurn = await collectStreamingAssistantTurn(
      client,
      request.model,
      conversation,
      availableToolDefinitions,
      callbacks,
    )

    if (!assistantTurn.toolCalls.length) {
      const answer =
        assistantTurn.text.trim() || 'The model returned no displayable content.'
      const finalResponse: ChatResponse = {
        model: request.model,
        answer,
        toolEvents,
      }
      await emitEvent(callbacks, {
        type: 'final',
        ...finalResponse,
      })
      return finalResponse
    }

    conversation.push({
      role: 'assistant',
      content: assistantTurn.text,
      tool_calls: assistantTurn.toolCalls,
    })

    for (const toolCall of assistantTurn.toolCalls) {
      const rawArguments = toolCall.function.arguments || '{}'
      const parsedArguments = JSON.parse(rawArguments) as Record<string, unknown>

      await emitEvent(callbacks, {
        type: 'tool-start',
        name: toolCall.function.name,
        input: JSON.stringify(parsedArguments, null, 2),
      })

      const output = await executeTool(
        provider,
        workspaceRoot,
        toolCall.function.name,
        parsedArguments,
        settings,
        request,
      )

      toolEvents.push({
        name: toolCall.function.name,
        input: JSON.stringify(parsedArguments, null, 2),
        output: sanitizeToolOutput(output),
      })

      await emitEvent(callbacks, {
        type: 'tool-result',
        name: toolCall.function.name,
        output: sanitizeToolOutput(output),
      })

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: output,
      })
    }
  }

  throw new Error('Agent exceeded the maximum tool loop count')
}

export async function runAgentChat(
  provider: ProviderConfig,
  settings: AppSettings,
  request: ChatRequest,
): Promise<ChatResponse> {
  return runAgentChatInternal(provider, settings, request)
}

export async function streamAgentChat(
  provider: ProviderConfig,
  settings: AppSettings,
  request: ChatRequest,
  callbacks: AgentCallbacks,
): Promise<ChatResponse> {
  return runAgentChatInternal(provider, settings, request, callbacks)
}

export function serializeAgentStreamEvent(event: AgentStreamEvent): string {
  return `${JSON.stringify(event)}\n`
}
