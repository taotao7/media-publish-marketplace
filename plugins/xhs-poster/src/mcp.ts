import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

export type { CallToolResult }
export { McpServer, StdioServerTransport }
export { z } from "zod"

export interface McpConfig {
  readonly name: string
  readonly version: string
  readonly description?: string
}

export interface McpInstance {
  readonly server: McpServer
  readonly connect: () => Promise<void>
}

export function createMcpServer(config: McpConfig): McpInstance {
  const server = new McpServer({
    name: config.name,
    version: config.version,
  })

  const connect = async (): Promise<void> => {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return { server, connect }
}
