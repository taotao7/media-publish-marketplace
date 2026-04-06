import type { BilibiliClientCredentials } from "./config.js"
import { exchangeCodeForToken, refreshAccessToken } from "./api.js"
import {
  loadAccountAuth,
  saveAccountAuth,
  type StoredAuth,
} from "./store.js"

const REFRESH_GRACE_SECONDS = 60

export async function exchangeCodeAndSave(
  account: string,
  config: BilibiliClientCredentials,
  code: string,
): Promise<StoredAuth> {
  const tokens = await exchangeCodeForToken(config, code)
  const auth = toStoredAuth(tokens)
  saveAccountAuth(account, auth)
  return auth
}

export async function refreshAccountAuth(
  account: string,
  config: BilibiliClientCredentials,
): Promise<StoredAuth> {
  const current = loadAccountAuth(account)
  if (!current) {
    throw new Error(
      `No saved authorization found for account '${account}'. Run get_auth_url and exchange_code first.`,
    )
  }

  const tokens = await refreshAccessToken(config, current.refreshToken)
  const refreshed = toStoredAuth(tokens)
  saveAccountAuth(account, refreshed)
  return refreshed
}

export async function ensureFreshAccountAuth(
  account: string,
  config: BilibiliClientCredentials,
): Promise<StoredAuth> {
  const current = loadAccountAuth(account)
  if (!current) {
    throw new Error(
      `No saved authorization found for account '${account}'. Run get_auth_url and exchange_code first.`,
    )
  }

  const now = Math.floor(Date.now() / 1_000)
  if (current.expiresAt > now + REFRESH_GRACE_SECONDS) {
    return current
  }

  return refreshAccountAuth(account, config)
}

function toStoredAuth(tokens: {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_in: number
  readonly scopes?: readonly string[]
}): StoredAuth {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Math.floor(Date.now() / 1_000) + tokens.expires_in,
    scopes: tokens.scopes || [],
    updatedAt: new Date().toISOString(),
  }
}
