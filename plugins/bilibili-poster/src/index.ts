import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { randomUUID } from "node:crypto"
import {
  DEFAULT_ACCOUNT,
  loadClientCredentials,
  loadOAuthConfig,
} from "./config.js"
import {
  buildPcOauthUrl,
  formatExpiry,
  listCategories,
  publishVideo,
  uploadCover,
} from "./api.js"
import {
  deleteAccountAuth,
  listAccounts,
  loadAccountAuth,
} from "./store.js"
import {
  ensureFreshAccountAuth,
  exchangeCodeAndSave,
  refreshAccountAuth,
} from "./auth.js"

const accountParam = z
  .string()
  .optional()
  .describe(
    "Account name for multi-account management. Defaults to 'default'. Each account stores its own OAuth tokens separately.",
  )

const redirectUriParam = z
  .string()
  .optional()
  .describe(
    "Optional OAuth callback URL. If omitted, the plugin uses BILIBILI_REDIRECT_URI.",
  )

const { server, connect } = createMcpServer({
  name: "mcp-bilibili-poster",
  version: "0.1.0",
  description:
    "Bilibili poster — authorize with the official Open Platform OAuth flow, upload covers, and publish videos via the official APIs.",
})

server.tool(
  "list_accounts",
  "List all saved Bilibili accounts that have stored OAuth tokens.",
  {},
  async (): Promise<CallToolResult> => {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No Bilibili accounts found. Use get_auth_url and exchange_code to authorize a new account.",
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
  "get_auth_url",
  "Generate the official Bilibili OAuth authorization URL for a web application. Open the returned URL in a browser, complete authorization, then pass the returned code to exchange_code.",
  {
    account: accountParam,
    redirect_uri: redirectUriParam,
    state: z
      .string()
      .optional()
      .describe(
        "Optional OAuth state value. If omitted, the plugin generates a random state string.",
      ),
  },
  async ({ account, redirect_uri, state }): Promise<CallToolResult> => {
    try {
      const acct = account || DEFAULT_ACCOUNT
      const config = loadOAuthConfig(redirect_uri)
      const oauthState = state || randomUUID()
      const url = buildPcOauthUrl(config, oauthState)

      return {
        content: [
          {
            type: "text",
            text: [
              `Account: ${acct}`,
              `State: ${oauthState}`,
              `Redirect URI: ${config.redirectUri}`,
              `Open this URL to authorize:`,
              url,
              "",
              "After Bilibili redirects back with ?code=..., call exchange_code with that code.",
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return errorResult(`Failed to build authorization URL: ${String(error)}`)
    }
  },
)

server.tool(
  "exchange_code",
  "Exchange an OAuth authorization code for access_token and refresh_token, then save them for the selected account.",
  {
    account: accountParam,
    redirect_uri: redirectUriParam,
    code: z.string().describe("The OAuth authorization code returned by Bilibili"),
  },
  async ({ account, redirect_uri, code }): Promise<CallToolResult> => {
    try {
      const acct = account || DEFAULT_ACCOUNT
      const config = loadOAuthConfig(redirect_uri)
      const auth = await exchangeCodeAndSave(acct, config, code)

      return {
        content: [
          {
            type: "text",
            text: [
              `Bilibili authorization saved for account '${acct}'.`,
              `Expires at: ${formatExpiry(auth.expiresAt)}`,
              `Scopes: ${auth.scopes.length > 0 ? auth.scopes.join(", ") : "(none reported)"}`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return errorResult(`Code exchange failed: ${String(error)}`)
    }
  },
)

server.tool(
  "refresh_access_token",
  "Refresh the saved access_token for a Bilibili account using its stored refresh_token.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT

    try {
      const config = loadClientCredentials()
      const auth = await refreshAccountAuth(acct, config)

      return {
        content: [
          {
            type: "text",
            text: [
              `Access token refreshed for account '${acct}'.`,
              `Expires at: ${formatExpiry(auth.expiresAt)}`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return errorResult(`Token refresh failed: ${String(error)}`)
    }
  },
)

server.tool(
  "check_login_status",
  "Check whether a saved Bilibili account has usable OAuth tokens. If the token is near expiry and client credentials are configured, the plugin attempts a refresh.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const current = loadAccountAuth(acct)

    if (!current) {
      return {
        content: [
          {
            type: "text",
            text: `Account '${acct}' is not authorized. Use get_auth_url and exchange_code to authenticate.`,
          },
        ],
      }
    }

    try {
      const config = loadClientCredentials()
      const effective = await ensureFreshAccountAuth(acct, config)

      return {
        content: [
          {
            type: "text",
            text: [
              `Account '${acct}' has a valid Bilibili authorization.`,
              `Expires at: ${formatExpiry(effective.expiresAt)}`,
              `Scopes: ${effective.scopes.length > 0 ? effective.scopes.join(", ") : "(none reported)"}`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return errorResult(
        `Account '${acct}' has saved tokens, but validation failed: ${String(error)}`,
      )
    }
  },
)

server.tool(
  "list_categories",
  "List Bilibili video categories (分区). Use the returned second-level category id as tid when publishing.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    try {
      const acct = account || DEFAULT_ACCOUNT
      const config = loadClientCredentials()
      const auth = await ensureFreshAccountAuth(acct, config)
      const categories = await listCategories(config, auth.accessToken)

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(categories, null, 2),
          },
        ],
      }
    } catch (error) {
      return errorResult(`Category lookup failed: ${String(error)}`)
    }
  },
)

server.tool(
  "upload_cover",
  "Upload a local image file as a Bilibili cover and return the official cover URL.",
  {
    account: accountParam,
    file_path: z
      .string()
      .describe("Absolute path to a local .jpg/.jpeg/.png cover image"),
  },
  async ({ account, file_path }): Promise<CallToolResult> => {
    try {
      const acct = account || DEFAULT_ACCOUNT
      const config = loadClientCredentials()
      const auth = await ensureFreshAccountAuth(acct, config)
      const url = await uploadCover(config, auth.accessToken, file_path)

      return {
        content: [
          {
            type: "text",
            text: url,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Cover upload failed: ${String(error)}`)
    }
  },
)

server.tool(
  "publish_video",
  "Upload a local video to Bilibili through the official Open Platform APIs and submit it as a new稿件.",
  {
    account: accountParam,
    title: z.string().describe("Video title, up to 80 characters"),
    video_path: z
      .string()
      .describe("Absolute path to the local video file to upload"),
    tid: z
      .number()
      .int()
      .describe("Category id (二级分区 id) from list_categories"),
    tags: z
      .array(z.string())
      .min(1)
      .describe("Video tags. The plugin joins them with commas for the API."),
    description: z
      .string()
      .optional()
      .describe("Video description, up to 250 characters"),
    cover_path: z
      .string()
      .optional()
      .describe(
        "Optional absolute path to a local cover image. If omitted, cover_url may be used instead.",
      ),
    cover_url: z
      .string()
      .optional()
      .describe(
        "Optional already-uploaded Bilibili cover URL. If omitted and cover_path is provided, the plugin uploads the cover first.",
      ),
    allow_reprint: z
      .boolean()
      .optional()
      .describe(
        "Whether others may reprint the video. Defaults to true (maps to no_reprint=0).",
      ),
    copyright: z
      .enum(["original", "reprint"])
      .optional()
      .describe("Whether this submission is original or reprint. Defaults to original."),
    source: z
      .string()
      .optional()
      .describe("Required when copyright is reprint."),
    topic_id: z
      .number()
      .int()
      .optional()
      .describe("Optional topic id. Usually requires coordination with Bilibili operations."),
    mission_id: z
      .number()
      .int()
      .optional()
      .describe("Optional mission/activity id. Usually requires coordination with Bilibili operations."),
  },
  async ({
    account,
    title,
    video_path,
    tid,
    tags,
    description,
    cover_path,
    cover_url,
    allow_reprint,
    copyright,
    source,
    topic_id,
    mission_id,
  }): Promise<CallToolResult> => {
    try {
      const acct = account || DEFAULT_ACCOUNT
      const config = loadClientCredentials()
      const auth = await ensureFreshAccountAuth(acct, config)
      const result = await publishVideo(config, {
        accessToken: auth.accessToken,
        title,
        videoPath: video_path,
        tid,
        tags,
        description,
        coverPath: cover_path,
        coverUrl: cover_url,
        noReprint: allow_reprint === false ? 1 : 0,
        copyright: copyright === "reprint" ? 2 : 1,
        source,
        topicId: topic_id,
        missionId: mission_id,
      })

      return {
        content: [
          {
            type: "text",
            text: [
              `Bilibili video submitted successfully (account: ${acct}).`,
              `Resource ID: ${result.resourceId}`,
              `Upload token: ${result.uploadToken}`,
              `Chunks uploaded: ${result.chunkCount}`,
              result.coverUrl ? `Cover URL: ${result.coverUrl}` : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }
    } catch (error) {
      return errorResult(`Video publish failed: ${String(error)}`)
    }
  },
)

server.tool(
  "delete_account_auth",
  "Delete the saved OAuth tokens for a Bilibili account and reset its authorization state.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const deleted = deleteAccountAuth(acct)

    return {
      content: [
        {
          type: "text",
          text: deleted
            ? `Deleted saved authorization for account '${acct}'.`
            : `No saved authorization found for account '${acct}'.`,
        },
      ],
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
