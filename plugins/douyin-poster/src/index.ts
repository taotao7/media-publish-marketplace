import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { launchBrowser } from "./browser.js"
import { deleteCookies, getCookiePath, listAccounts } from "./cookies.js"
import { checkLoginStatus, fetchQrcode, waitForLogin } from "./login.js"
import { publishVideo } from "./publish.js"

const DEFAULT_ACCOUNT = "default"

const accountParam = z
  .string()
  .optional()
  .describe(
    "Account name for multi-account management. Defaults to 'default'. Each account stores its own cookies separately.",
  )

const { server, connect } = createMcpServer({
  name: "mcp-douyin-poster",
  version: "0.1.0",
  description:
    "Douyin poster — login with QR code, persist cookies, and publish videos with Puppeteer.",
})

server.tool(
  "list_accounts",
  "List all saved Douyin accounts that have stored cookies.",
  {},
  async (): Promise<CallToolResult> => {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No Douyin accounts found. Use get_login_qrcode to log in with a new account.",
          },
        ],
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Saved Douyin accounts (${accounts.length}):\n${accounts.map((account) => `  - ${account}`).join("\n")}`,
        },
      ],
    }
  },
)

server.tool(
  "check_login_status",
  "Check whether the current saved cookies represent a valid Douyin creator login session.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)

    try {
      const status = await checkLoginStatus(managed.page)
      if (status.loggedIn) {
        await managed.saveCookies()
      }

      return {
        content: [
          {
            type: "text",
            text: status.loggedIn
              ? `Account '${acct}' is logged in to Douyin creator platform.`
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

server.tool(
  "get_login_qrcode",
  "Get a QR code image for Douyin creator login. After returning the QR code, the tool polls in the background for up to 4 minutes waiting for the user to scan. Cookies are saved automatically on success.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)

    try {
      const result = await fetchQrcode(managed.page, acct)
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

      void (async () => {
        try {
          const success = await waitForLogin(managed.page)
          if (success) {
            await managed.saveCookies()
          }
        } catch {
          // background polling errors are intentionally silent
        } finally {
          await managed.close()
        }
      })()

      return {
        content: [
          {
            type: "text",
            text: [
              `QR code saved to: ${result.path}`,
              `Account: ${acct}`,
              `Please open this file with an image viewer (e.g. run: open "${result.path}") and scan it with the Douyin app to log in.`,
              "Waiting up to 4 minutes for login…",
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

server.tool(
  "publish_video",
  "Publish a video to Douyin creator platform. Requires prior login and a local video file path.",
  {
    account: accountParam,
    title: z.string().describe("Video title"),
    content: z
      .string()
      .optional()
      .describe("Video description or intro text"),
    video_path: z
      .string()
      .describe("Absolute path to the local video file to upload"),
    tags: z
      .array(z.string())
      .max(5)
      .optional()
      .describe("Tags or topics to attach (max 5)"),
    visibility: z
      .enum(["public", "private"])
      .optional()
      .describe("Visibility of the published video. Defaults to public."),
  },
  async ({
    account,
    title,
    content,
    video_path,
    tags,
    visibility,
  }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)

    try {
      await publishVideo(managed.page, {
        title,
        content,
        videoPath: video_path,
        tags,
        visibility,
      })
      await managed.saveCookies()

      return {
        content: [
          {
            type: "text",
            text: `Douyin video submitted successfully (account: ${acct}).`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Publish failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

server.tool(
  "delete_cookies",
  "Delete saved Douyin cookies to reset login state for a specific account.",
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

await connect()

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}
