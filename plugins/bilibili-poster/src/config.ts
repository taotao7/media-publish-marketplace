import { homedir } from "node:os"
import { join } from "node:path"

export const DEFAULT_ACCOUNT = "default"
export const DEFAULT_AUTH_BASE_URL =
  "https://account.bilibili.com/pc/account-pc/auth/oauth"

export interface BilibiliClientCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

export interface BilibiliOAuthConfig extends BilibiliClientCredentials {
  readonly redirectUri: string
  readonly authBaseUrl: string
}

export function getDataRoot(): string {
  return process.env.BILIBILI_DATA_PATH
    ? process.env.BILIBILI_DATA_PATH
    : join(homedir(), ".media-mcp", "bilibili")
}

export function loadClientCredentials(): BilibiliClientCredentials {
  const clientId = getRequiredEnv("BILIBILI_CLIENT_ID")
  const clientSecret = getRequiredEnv("BILIBILI_CLIENT_SECRET")

  return {
    clientId,
    clientSecret,
  }
}

export function loadOAuthConfig(
  overrideRedirectUri?: string,
): BilibiliOAuthConfig {
  const { clientId, clientSecret } = loadClientCredentials()
  const redirectUri = overrideRedirectUri || process.env.BILIBILI_REDIRECT_URI

  if (!redirectUri) {
    throw new Error(
      "Missing redirect URI. Set BILIBILI_REDIRECT_URI or pass redirect_uri to the tool.",
    )
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    authBaseUrl: process.env.BILIBILI_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL,
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
