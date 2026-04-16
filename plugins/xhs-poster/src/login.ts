import type { Page } from "puppeteer"
import { LOGGED_IN_INDICATOR, QRCODE_IMG } from "./selectors.js"

const EXPLORE_URL = "https://www.xiaohongshu.com/explore"
const POLL_INTERVAL_MS = 500

export interface LoginStatus {
  readonly loggedIn: boolean
}

export interface QrcodeResult {
  readonly alreadyLoggedIn: boolean
}

export async function checkLoginStatus(page: Page): Promise<LoginStatus> {
  await page.goto(EXPLORE_URL, { waitUntil: "load" })
  await delay(2000)

  const loggedIn = await elementExists(page, LOGGED_IN_INDICATOR)
  return { loggedIn }
}

export async function fetchQrcode(page: Page): Promise<QrcodeResult> {
  await page.goto(EXPLORE_URL, { waitUntil: "load" })
  await delay(2000)

  if (await elementExists(page, LOGGED_IN_INDICATOR)) {
    return { alreadyLoggedIn: true }
  }

  await page.waitForSelector(QRCODE_IMG, { timeout: 15_000 })

  return { alreadyLoggedIn: false }
}

export async function waitForLogin(
  page: Page,
  timeoutMs: number = 240_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await elementExists(page, LOGGED_IN_INDICATOR)) {
      return true
    }
    await delay(POLL_INTERVAL_MS)
  }

  return false
}

// ── helpers ──────────────────────────────────────────────────────────

async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    return (await page.$(selector)) !== null
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
