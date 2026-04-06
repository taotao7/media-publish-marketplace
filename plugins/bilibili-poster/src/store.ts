import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { getDataRoot } from "./config.js"

export interface StoredAuth {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly scopes: readonly string[]
  readonly updatedAt: string
}

function getAccountsDir(): string {
  return join(getDataRoot(), "accounts")
}

export function getAccountDir(account: string): string {
  return join(getAccountsDir(), account)
}

export function getAuthPath(account: string): string {
  return join(getAccountDir(account), "auth.json")
}

export function listAccounts(): string[] {
  const accountsDir = getAccountsDir()
  if (!existsSync(accountsDir)) {
    return []
  }

  return readdirSync(accountsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((account) => existsSync(getAuthPath(account)))
    .sort()
}

export function loadAccountAuth(account: string): StoredAuth | null {
  try {
    const raw = readFileSync(getAuthPath(account), "utf-8")
    return JSON.parse(raw) as StoredAuth
  } catch {
    return null
  }
}

export function saveAccountAuth(account: string, auth: StoredAuth): void {
  mkdirSync(getAccountDir(account), { recursive: true })
  writeFileSync(getAuthPath(account), JSON.stringify(auth, null, 2))
}

export function deleteAccountAuth(account: string): boolean {
  const dir = getAccountDir(account)
  if (!existsSync(dir)) {
    return false
  }

  rmSync(dir, { recursive: true, force: true })
  return true
}
