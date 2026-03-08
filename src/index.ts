import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { launchBrowser } from "./browser.js"
import { deleteCookies, getCookiePath, listAccounts } from "./cookies.js"
import { checkLoginStatus, fetchQrcode, waitForLogin } from "./login.js"
import { publishContent } from "./publish.js"
import { qrcodeToCleanPng } from "./qrcode.js"
import { uploadToR2 } from "./r2.js"

const DEFAULT_ACCOUNT = "default"

const accountParam = z
  .string()
  .optional()
  .describe(
    "Account name for multi-account management. Defaults to 'default'. Each account stores its own cookies separately.",
  )

const { server, connect } = createMcpServer({
  name: "mcp-xhs-poster",
  version: "0.1.0",
  description:
    "Xiaohongshu poster — login, publish image posts, manage cookies. Supports multiple accounts.",
})

// ── list_accounts ─────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all saved Xiaohongshu accounts that have stored cookies.",
  {},
  async (): Promise<CallToolResult> => {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No accounts found. Use get_login_qrcode to log in with a new account.",
          },
        ],
      }
    }
    return {
      content: [
        {
          type: "text",
          text: `Saved accounts (${accounts.length}):\n${accounts.map((a) => `  - ${a}`).join("\n")}`,
        },
      ],
    }
  },
)

// ── check_login_status ───────────────────────────────────────────────

server.tool(
  "check_login_status",
  "Check whether the current saved cookies represent a valid Xiaohongshu login session.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const { loggedIn } = await checkLoginStatus(managed.page)
      return {
        content: [
          {
            type: "text",
            text: loggedIn
              ? `Account '${acct}' is logged in to Xiaohongshu.`
              : `Account '${acct}' is not logged in. Use get_login_qrcode to authenticate.`,
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
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const result = await fetchQrcode(managed.page)

      if (result.alreadyLoggedIn) {
        await managed.close()
        return {
          content: [
            {
              type: "text",
              text: `Account '${acct}' is already logged in — no QR code needed.`,
            },
          ],
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
      const qrPath = join(qrDir, `qrcode-${acct}.png`)
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
              `Account: ${acct}`,
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
    account: accountParam,
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
      .describe(
        "Absolute paths to local attachment files (e.g. prompt.txt)",
      ),
  },
  async ({
    account,
    title,
    content,
    images,
    tags,
    schedule_at,
    attachments,
  }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
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
              ? `Post scheduled for ${schedule_at} (account: ${acct}).`
              : `Post published successfully (account: ${acct}).`,
          },
        ],
      }
    } catch (error) {
      console.error(
        "[publish] ERROR — keeping browser open 30s for inspection",
      )
      await new Promise((r) => setTimeout(r, 30_000))
      return errorResult(`Publish failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── upload_image ────────────────────────────────────────────────────

server.tool(
  "upload_image",
  "Upload a local image to Cloudflare R2 and return its public URL. Use this when markdown content needs to reference images — upload first, then use the returned URL.",
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

// ── delete_cookies ───────────────────────────────────────────────────

server.tool(
  "delete_cookies",
  "Delete saved Xiaohongshu cookies to reset login state for a specific account.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    try {
      const path = getCookiePath(acct)
      await deleteCookies(acct)
      return {
        content: [
          {
            type: "text",
            text: `Cookies deleted for account '${acct}': ${path}`,
          },
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
