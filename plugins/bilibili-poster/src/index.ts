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
  name: "mcp-bilibili-poster",
  version: "0.1.0",
  description:
    "Bilibili poster — login with QR code, persist cookies, and publish videos with Puppeteer.",
})

server.tool(
  "list_accounts",
  "List all saved Bilibili accounts that have stored cookies.",
  {},
  async (): Promise<CallToolResult> => {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No Bilibili accounts found. Use get_login_qrcode to log in with a new account.",
          },
        ],
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Saved Bilibili accounts (${accounts.length}):\n${accounts.map((account) => `  - ${account}`).join("\n")}`,
        },
      ],
    }
  },
)

server.tool(
  "check_login_status",
  "Check whether the current saved cookies represent a valid Bilibili creator login session.",
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
              ? `Account '${acct}' is logged in to Bilibili creator platform.`
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
  "Open a visible browser window for Bilibili creator login. The tool keeps polling in the background for up to 4 minutes while the user scans the QR code in the browser. Cookies are saved automatically on success.",
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
              "Scan the QR code directly in the opened browser window with the Bilibili app.",
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
  "Publish a video to Bilibili creator platform. Requires prior login and a local video file path.",
  {
    account: accountParam,
    title: z.string().describe("Video title"),
    description: z
      .string()
      .optional()
      .describe("Video description or introduction text"),
    video_path: z
      .string()
      .describe("Absolute path to the local video file to upload"),
    tags: z
      .array(z.string())
      .max(12)
      .optional()
      .describe("Tags to attach to the submission"),
    category: z
      .string()
      .optional()
      .describe(
        "Optional Bilibili category text to click in the web UI, for example '生活/日常' or '日常'. If omitted, the page keeps its current category selection.",
      ),
    copyright: z
      .enum(["original", "repost"])
      .optional()
      .describe("Copyright type. Defaults to original."),
    source: z
      .string()
      .optional()
      .describe("Required when copyright is repost."),
    schedule_at: z
      .string()
      .optional()
      .describe("ISO 8601 datetime to schedule the submission. If provided, the video will be scheduled instead of published immediately."),
    submit_mode: z
      .enum(["publish", "draft", "schedule"])
      .optional()
      .describe("Whether to publish immediately, save as a draft, or schedule publication. Defaults to publish. If schedule_at is provided, schedule mode is used automatically."),
  },
  async ({
    account,
    title,
    description,
    video_path,
    tags,
    category,
    copyright,
    source,
    schedule_at,
    submit_mode,
  }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)

    try {
      await publishVideo(managed.page, {
        title,
        description,
        videoPath: video_path,
        tags,
        category,
        copyright,
        source,
        scheduleAt: schedule_at,
        submitMode: submit_mode,
      })
      await managed.saveCookies()

      const effectiveMode =
        schedule_at || submit_mode === "schedule"
          ? "schedule"
          : submit_mode === "draft"
            ? "draft"
            : "publish"

      return {
        content: [
          {
            type: "text",
            text:
              effectiveMode === "draft"
                ? `Bilibili video draft saved successfully (account: ${acct}).`
                : effectiveMode === "schedule"
                  ? `Bilibili video scheduled for ${schedule_at} (account: ${acct}).`
                  : `Bilibili video submitted successfully (account: ${acct}).`,
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
  "Delete the saved cookies for a Bilibili account.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const path = getCookiePath(acct)
    await deleteCookies(acct)

    return {
      content: [
        {
          type: "text",
          text: `Deleted saved cookies for account '${acct}'.\nPath: ${path}`,
        },
      ],
    }
  },
)

await connect()

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}
