import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { launchBrowser } from "./browser.js"
import { deleteCookies, getCookiePath } from "./cookies.js"
import { checkLoginStatus, fetchQrcode, waitForLogin } from "./login.js"
import { publishContent } from "./publish.js"
import { qrcodeToCleanPng } from "./qrcode.js"

const { server, connect } = createMcpServer({
  name: "mcp-xhs-poster",
  version: "0.1.0",
  description: "Xiaohongshu poster — login, publish image posts, manage cookies",
})

// ── check_login_status ───────────────────────────────────────────────

server.tool(
  "check_login_status",
  "Check whether the current saved cookies represent a valid Xiaohongshu login session.",
  {},
  async (): Promise<CallToolResult> => {
    const managed = await launchBrowser()
    try {
      const { loggedIn } = await checkLoginStatus(managed.page)
      return {
        content: [
          {
            type: "text",
            text: loggedIn
              ? "Logged in to Xiaohongshu."
              : "Not logged in. Use get_login_qrcode to authenticate.",
          },
        ],
      }
    } catch (error) {
      return errorResult(`Login check failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── get_login_qrcode ─────────────────────────────────────────────────

server.tool(
  "get_login_qrcode",
  "Get a QR code image for Xiaohongshu login. After returning the QR code, the tool polls in the background for up to 4 minutes waiting for the user to scan. Cookies are saved automatically on success.",
  {},
  async (): Promise<CallToolResult> => {
    const managed = await launchBrowser()
    try {
      const result = await fetchQrcode(managed.page)

      if (result.alreadyLoggedIn) {
        await managed.close()
        return {
          content: [{ type: "text", text: "Already logged in — no QR code needed." }],
        }
      }

      // Start background polling — browser stays open until login or timeout
      void (async () => {
        try {
          const success = await waitForLogin(managed.page)
          if (success) {
            await managed.saveCookies()
          }
        } catch {
          // polling failed silently
        } finally {
          await managed.close()
        }
      })()

      const base64Data = result.img!.replace(/^data:image\/\w+;base64,/, "")
      const qrDir = join(homedir(), ".media-mcp")
      mkdirSync(qrDir, { recursive: true })
      const qrPath = join(qrDir, "qrcode.png")
      writeFileSync(qrPath, Buffer.from(base64Data, "base64"))

      let cleanBase64: string | undefined
      try {
        cleanBase64 = await qrcodeToCleanPng(base64Data)
      } catch {
        // fall back to original image
      }

      // Save clean version if available
      if (cleanBase64) {
        writeFileSync(qrPath, Buffer.from(cleanBase64, "base64"))
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `QR code saved to: ${qrPath}`,
              `Please open this file with an image viewer (e.g. run: open "${qrPath}") and scan it with the Xiaohongshu app to log in.`,
              `Waiting up to 4 minutes for login…`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      await managed.close()
      return errorResult(`QR code fetch failed: ${String(error)}`)
    }
  },
)

// ── publish_content ──────────────────────────────────────────────────

server.tool(
  "publish_content",
  "Publish an image post to Xiaohongshu. Requires prior login (cookies must exist). Uploads local image files, fills in title/content/tags, and optionally schedules the post.",
  {
    title: z.string().describe("Post title"),
    content: z.string().describe("Post body text"),
    images: z
      .array(z.string())
      .min(1)
      .describe("Absolute paths to local image files"),
    tags: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("Hashtags to attach (max 10)"),
    schedule_at: z
      .string()
      .optional()
      .describe(
        "ISO 8601 datetime for scheduled publishing (1 hour – 14 days from now)",
      ),
    attachments: z
      .array(z.string())
      .optional()
      .describe("Absolute paths to local attachment files (e.g. prompt.txt)"),
  },
  async ({ title, content, images, tags, schedule_at, attachments }): Promise<CallToolResult> => {
    const managed = await launchBrowser()
    try {
      await publishContent(managed.page, {
        title,
        content,
        images,
        tags,
        scheduleAt: schedule_at,
        attachments,
      })
      await managed.saveCookies()
      return {
        content: [
          {
            type: "text",
            text: schedule_at
              ? `Post scheduled for ${schedule_at}.`
              : "Post published successfully.",
          },
        ],
      }
    } catch (error) {
      console.error("[publish] ERROR — keeping browser open 30s for inspection")
      await new Promise((r) => setTimeout(r, 30_000))
      return errorResult(`Publish failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── delete_cookies ───────────────────────────────────────────────────

server.tool(
  "delete_cookies",
  "Delete saved Xiaohongshu cookies to reset login state.",
  {},
  async (): Promise<CallToolResult> => {
    try {
      const path = getCookiePath()
      await deleteCookies()
      return {
        content: [
          { type: "text", text: `Cookies deleted: ${path}` },
        ],
      }
    } catch (error) {
      return errorResult(`Delete cookies failed: ${String(error)}`)
    }
  },
)

// ── helpers ──────────────────────────────────────────────────────────

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
