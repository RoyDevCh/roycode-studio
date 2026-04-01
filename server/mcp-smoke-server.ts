import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'roycode-smoke-server',
    version: '0.1.0',
  })

  server.registerTool(
    'echo',
    {
      description: 'Echo the provided text and value back to the client.',
      inputSchema: {
        text: z.string().optional(),
        value: z.any().optional(),
      },
    },
    async ({ text, value }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              text: text ?? '',
              value: value ?? null,
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerPrompt(
    'summarize',
    {
      description: 'Return a simple text prompt for smoke testing.',
      argsSchema: {
        topic: z.string().optional(),
      },
    },
    async ({ topic }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Summarize ${topic || 'the current workspace'} in a short paragraph.`,
          },
        },
      ],
    }),
  )

  server.registerResource(
    'guide',
    'memo://roycode-smoke/guide',
    {
      description: 'A small text resource exposed by the smoke MCP server.',
      mimeType: 'text/plain',
    },
    async uri => ({
      contents: [
        {
          uri: uri.toString(),
          text: 'RoyCode MCP smoke resource',
          mimeType: 'text/plain',
        },
      ],
    }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
