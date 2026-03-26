import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ElementHandle, Page } from "puppeteer"
import {
  CREATOR_UPLOAD_URL,
  FILE_INPUT_SELECTORS,
  LOGIN_PHONE_INPUT_SELECTORS,
  LOGIN_QRCODE_SELECTORS,
  LOGIN_TEXTS,
  PUBLISH_BUTTON_SELECTORS,
  PUBLISH_READY_TEXTS,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const POLL_INTERVAL_MS = 1_000

export interface LoginStatus {
  readonly loggedIn: boolean
  readonly currentUrl: string
}

export interface QrcodeResult {
  readonly alreadyLoggedIn: boolean
  readonly path?: string
}

interface AuthSignals {
  readonly hasLoginPrompt: boolean
  readonly hasPublishPrompt: boolean
}

export async function checkLoginStatus(page: Page): Promise<LoginStatus> {
  await openCreatorUpload(page)
  return detectLoginStatus(page)
}

export async function detectLoginStatus(page: Page): Promise<LoginStatus> {
  const deadline = Date.now() + 10_000
  let lastSignals: AuthSignals = {
    hasLoginPrompt: false,
    hasPublishPrompt: false,
  }

  while (Date.now() < deadline) {
    lastSignals = await inspectAuthSignals(page)
    if (lastSignals.hasLoginPrompt || lastSignals.hasPublishPrompt) {
      break
    }
    await delay(500)
  }

  return {
    // Only consider not logged in when there's an explicit login prompt.
    // Absence of publish signals (e.g. page still loading) is NOT a login failure.
    loggedIn: !lastSignals.hasLoginPrompt,
    currentUrl: page.url(),
  }
}

export async function fetchQrcode(
  page: Page,
  account: string,
): Promise<QrcodeResult> {
  await openCreatorUpload(page)
  const status = await detectLoginStatus(page)
  if (status.loggedIn) {
    return { alreadyLoggedIn: true }
  }

  await switchToQrcodeLogin(page)
  const imgSrc = await waitForQrcodeSrc(page)

  const qrcodeDir = join(homedir(), ".media-mcp", "douyin")
  mkdirSync(qrcodeDir, { recursive: true })
  const qrcodePath = join(qrcodeDir, `qrcode-${account}.png`)

  const base64Data = imgSrc.replace(/^data:image\/\w+;base64,/, "")
  writeFileSync(qrcodePath, Buffer.from(base64Data, "base64"))

  return {
    alreadyLoggedIn: false,
    path: qrcodePath,
  }
}

export async function waitForLogin(
  page: Page,
  timeoutMs: number = 240_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const status = await detectLoginStatus(page)
    if (status.loggedIn) {
      return true
    }
    await delay(POLL_INTERVAL_MS)
  }

  return false
}

async function openCreatorUpload(page: Page): Promise<void> {
  await page.goto(CREATOR_UPLOAD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await delay(4_000)
}

async function inspectAuthSignals(page: Page): Promise<AuthSignals> {
  try {
    const hasLoginSelector =
      (await selectorExists(page, LOGIN_QRCODE_SELECTORS)) ||
      (await selectorExists(page, LOGIN_PHONE_INPUT_SELECTORS))

    const hasPublishSelector =
      (await selectorExists(page, FILE_INPUT_SELECTORS)) ||
      (await selectorExists(page, TITLE_INPUT_SELECTORS)) ||
      (await selectorExists(page, PUBLISH_BUTTON_SELECTORS))

    const textSignals = await page.evaluate(
      ({ loginTexts, publishReadyTexts }) => {
        const text = document.body.innerText.replace(/\s+/g, " ")
        return {
          hasLoginText: loginTexts.some((item) => text.includes(item)),
          hasPublishText: publishReadyTexts.some((item) => text.includes(item)),
        }
      },
      {
        loginTexts: [...LOGIN_TEXTS],
        publishReadyTexts: [...PUBLISH_READY_TEXTS],
      },
    )

    return {
      hasLoginPrompt: hasLoginSelector || textSignals.hasLoginText,
      hasPublishPrompt: hasPublishSelector || textSignals.hasPublishText,
    }
  } catch {
    // Page navigated during evaluation — treat as transitioning, no definitive signal
    return { hasLoginPrompt: false, hasPublishPrompt: false }
  }
}

async function switchToQrcodeLogin(page: Page): Promise<void> {
  if (await selectorExists(page, LOGIN_QRCODE_SELECTORS)) {
    return
  }

  const switched = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("button, div, span, a, li"),
    )

    for (const candidate of candidates) {
      const text = candidate.textContent?.replace(/\s+/g, " ").trim() ?? ""
      if (text === "扫码登录") {
        ;(candidate as HTMLElement).click()
        return true
      }
    }

    return false
  })

  if (switched) {
    await delay(1_000)
  }
}

async function waitForQrcodeSrc(page: Page): Promise<string> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    const src = await page.evaluate((selectors) => {
      // Try class-based selectors first
      for (const sel of selectors) {
        const img = document.querySelector(sel) as HTMLImageElement | null
        if (img?.src && img.naturalWidth >= 100 && img.naturalHeight >= 100) {
          return img.src
        }
      }
      // Fallback: any large base64 PNG
      for (const img of Array.from(document.querySelectorAll("img")) as HTMLImageElement[]) {
        if (
          img.src.startsWith("data:image/") &&
          img.naturalWidth >= 100 &&
          img.naturalHeight >= 100
        ) {
          return img.src
        }
      }
      return null
    }, [...LOGIN_QRCODE_SELECTORS])

    if (src) return src
    await delay(500)
  }

  throw new Error("Douyin QR code not found")
}

async function selectorExists(
  page: Page,
  selectors: readonly string[],
): Promise<boolean> {
  return (await firstExistingSelector(page, selectors)) !== null
}

async function firstExistingSelector(
  page: Page,
  selectors: readonly string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector)
    if (handle) {
      await handle.dispose()
      return selector
    }
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
