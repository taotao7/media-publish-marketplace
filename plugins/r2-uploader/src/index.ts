import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { uploadToR2 } from "./r2.js"

const { server, connect } = createMcpServer({
  name: "mcp-r2-uploader",
  version: "0.1.0",
  description:
    "Cloudflare R2 uploader — upload local images and return public URLs.",
})

server.tool(
  "upload_image",
  "Upload a local image to Cloudflare R2 and return its public URL.",
  {
    file_path: z.string().describe("Absolute path to the local image file"),
  },
  async ({ file_path }): Promise<CallToolResult> => {
    try {
      const url = await uploadToR2(file_path)
      return {
        content: [{ type: "text", text: url }],
      }
    } catch (error) {
      return errorResult(`Image upload failed: ${String(error)}`)
    }
  },
)

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

process.on("SIGINT", () => {
  process.exit(0)
})

await connect()
