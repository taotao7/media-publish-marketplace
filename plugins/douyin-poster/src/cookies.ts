import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type { CookieParam } from "puppeteer"

function getAccountsDir(): string {
  return process.env.DOUYIN_COOKIES_PATH
    ? join(process.env.DOUYIN_COOKIES_PATH, "accounts")
    : join(homedir(), ".media-mcp", "douyin", "accounts")
}

export function getAccountDir(account: string): string {
  return join(getAccountsDir(), account)
}

export function getCookiePath(account: string): string {
  return join(getAccountDir(account), "cookies.json")
}

export async function loadCookies(
  account: string,
): Promise<readonly CookieParam[]> {
  const path = getCookiePath(account)
  if (!existsSync(path)) return []

  try {
    const raw = readFileSync(path, "utf-8")
    return JSON.parse(raw) as CookieParam[]
  } catch {
    return []
  }
}

export async function saveCookies(
  cookies: readonly CookieParam[],
  account: string,
): Promise<void> {
  const path = getCookiePath(account)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cookies, null, 2), "utf-8")
}

export async function deleteCookies(account: string): Promise<void> {
  const path = getCookiePath(account)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export function listAccounts(): string[] {
  const accountsDir = getAccountsDir()
  if (!existsSync(accountsDir)) return []

  return readdirSync(accountsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(accountsDir, entry.name, "cookies.json")),
    )
    .map((entry) => entry.name)
}
