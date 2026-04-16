import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { launchBrowser } from "./browser.js"
import { deleteCookies, getCookiePath, listAccounts } from "./cookies.js"
import { checkLoginStatus, fetchQrcode, waitForLogin } from "./login.js"
import { publishVideo, publishImages } from "./publish.js"

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
  "Open a visible browser window for Douyin creator login. The tool keeps polling in the background for up to 4 minutes while the user scans the QR code in the browser. Cookies are saved automatically on success.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct, { headless: false })

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
              `Browser login window opened for account: ${acct}`,
              "Scan the QR code directly in the opened browser window with the Douyin app.",
              "Keep the browser window open while login is being detected.",
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
    schedule_at: z
      .string()
      .optional()
      .describe("ISO 8601 datetime to schedule the post (e.g. 2026-04-01T18:00:00). Must be in the future. If omitted, publishes immediately."),
  },
  async ({
    account,
    title,
    content,
    video_path,
    tags,
    visibility,
    schedule_at,
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
        scheduleAt: schedule_at,
      })
      await managed.saveCookies()

      return {
        content: [
          {
            type: "text",
            text: schedule_at
              ? `Douyin video scheduled for ${schedule_at} (account: ${acct}).`
              : `Douyin video submitted successfully (account: ${acct}).`,
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
  "publish_images",
  "Publish an image post (图文) to Douyin creator platform. Requires prior login and local image file paths.",
  {
    account: accountParam,
    title: z.string().describe("Post title"),
    content: z.string().optional().describe("Post description or intro text"),
    image_paths: z
      .array(z.string())
      .min(1)
      .describe("Absolute paths to local image files to upload (at least one)"),
    tags: z
      .array(z.string())
      .max(5)
      .optional()
      .describe("Tags or topics to attach (max 5)"),
    visibility: z
      .enum(["public", "private"])
      .optional()
      .describe("Visibility of the published post. Defaults to public."),
    schedule_at: z
      .string()
      .optional()
      .describe("ISO 8601 datetime to schedule the post (e.g. 2026-04-01T18:00:00). Must be in the future. If omitted, publishes immediately."),
  },
  async ({ account, title, content, image_paths, tags, visibility, schedule_at }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)

    try {
      await publishImages(managed.page, {
        title,
        content,
        imagePaths: image_paths,
        tags,
        visibility,
        scheduleAt: schedule_at,
      })
      await managed.saveCookies()

      return {
        content: [
          {
            type: "text",
            text: schedule_at
              ? `Douyin image post scheduled for ${schedule_at} (account: ${acct}, images: ${image_paths.length}).`
              : `Douyin image post submitted successfully (account: ${acct}, images: ${image_paths.length}).`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Publish images failed: ${String(error)}`)
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
