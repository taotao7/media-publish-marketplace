import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { homedir } from "node:os"
import type { CookieParam } from "puppeteer"

const DEFAULT_PATH = `${homedir()}/.media-mcp/xhs-cookies.json`

export function getCookiePath(): string {
  return process.env.XHS_COOKIES_PATH ?? DEFAULT_PATH
}

export async function loadCookies(): Promise<readonly CookieParam[]> {
  const path = getCookiePath()
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
): Promise<void> {
  const path = getCookiePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cookies, null, 2), "utf-8")
}

export async function deleteCookies(): Promise<void> {
  const path = getCookiePath()
  if (existsSync(path)) {
    unlinkSync(path)
  }
}
