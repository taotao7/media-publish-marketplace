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
  "Get a QR code image for Bilibili creator login. After returning the QR code, the tool polls in the background for up to 4 minutes waiting for the user to scan. Cookies are saved automatically on success.",
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
              `Please open this file with an image viewer (e.g. run: open "${result.path}") and scan it with the Bilibili app to log in.`,
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
    submit_mode: z
      .enum(["publish", "draft"])
      .optional()
      .describe("Whether to submit the video immediately or save it as a draft. Defaults to publish."),
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
        submitMode: submit_mode,
      })
      await managed.saveCookies()

      return {
        content: [
          {
            type: "text",
            text:
              submit_mode === "draft"
                ? `Bilibili video draft saved successfully (account: ${acct}).`
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
