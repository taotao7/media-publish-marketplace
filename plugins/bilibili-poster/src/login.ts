import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Frame, Page } from "puppeteer"
import {
  CREATOR_READY_TEXTS,
  CREATOR_UPLOAD_URL,
  FILE_INPUT_SELECTORS,
  LOGIN_QRCODE_SELECTORS,
  LOGIN_TEXTS,
  PUBLISH_BUTTON_SELECTORS,
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
  readonly hasCreatorPrompt: boolean
}

export async function checkLoginStatus(page: Page): Promise<LoginStatus> {
  await openCreatorUpload(page)
  return detectLoginStatus(page)
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

  const qrcodeData = await waitForQrcodeData(page)
  const qrcodeDir = join(homedir(), ".media-mcp", "bilibili")
  mkdirSync(qrcodeDir, { recursive: true })
  const qrcodePath = join(qrcodeDir, `qrcode-${account}.png`)
  const imageBuffer = await loadImageBuffer(qrcodeData)
  writeFileSync(qrcodePath, imageBuffer)

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

export async function detectLoginStatus(page: Page): Promise<LoginStatus> {
  const deadline = Date.now() + 10_000
  let lastSignals: AuthSignals = {
    hasLoginPrompt: false,
    hasCreatorPrompt: false,
  }

  while (Date.now() < deadline) {
    lastSignals = await inspectAuthSignals(page)
    if (lastSignals.hasLoginPrompt || lastSignals.hasCreatorPrompt) {
      break
    }
    await delay(500)
  }

  const onPassportPage = page.url().includes("passport.bilibili.com")
  const loggedIn =
    !lastSignals.hasLoginPrompt &&
    (lastSignals.hasCreatorPrompt || (!onPassportPage && page.url().includes("member.bilibili.com")))

  return {
    loggedIn,
    currentUrl: page.url(),
  }
}

async function openCreatorUpload(page: Page): Promise<void> {
  await page.goto(CREATOR_UPLOAD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await delay(4_000)
}

async function inspectAuthSignals(page: Page): Promise<AuthSignals> {
  const currentUrl = page.url()
  const frames = page.frames()

  const hasLoginSelector = await anyFrameSelectorExists(frames, LOGIN_QRCODE_SELECTORS)
  const hasCreatorSelector =
    (await anyFrameSelectorExists(frames, FILE_INPUT_SELECTORS)) ||
    (await anyFrameSelectorExists(frames, TITLE_INPUT_SELECTORS)) ||
    (await anyFrameSelectorExists(frames, PUBLISH_BUTTON_SELECTORS))

  const hasLoginText = await anyFrameTextIncludes(frames, LOGIN_TEXTS)
  const hasCreatorText = await anyFrameTextIncludes(frames, CREATOR_READY_TEXTS)

  return {
    hasLoginPrompt:
      currentUrl.includes("passport.bilibili.com") || hasLoginSelector || hasLoginText,
    hasCreatorPrompt:
      currentUrl.includes("member.bilibili.com") &&
      !currentUrl.includes("passport.bilibili.com") &&
      (hasCreatorSelector || hasCreatorText),
  }
}

async function waitForQrcodeData(page: Page): Promise<string> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    const frames = page.frames()
    for (const frame of frames) {
      const data = await extractQrcodeData(frame)
      if (data) {
        return data
      }
    }
    await delay(500)
  }

  throw new Error("Bilibili QR code not found")
}

async function extractQrcodeData(frame: Frame): Promise<string | null> {
  try {
    return await frame.evaluate((selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector)
        if (!element) continue

        if (
          element instanceof HTMLImageElement &&
          element.naturalWidth >= 100 &&
          element.naturalHeight >= 100 &&
          element.src
        ) {
          return element.src
        }

        if (
          element instanceof HTMLCanvasElement &&
          element.width >= 100 &&
          element.height >= 100
        ) {
          return element.toDataURL("image/png")
        }
      }

      for (const img of Array.from(document.querySelectorAll("img"))) {
        if (
          img.naturalWidth >= 100 &&
          img.naturalHeight >= 100 &&
          img.src
        ) {
          return img.src
        }
      }

      for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
        if (canvas.width >= 100 && canvas.height >= 100) {
          return canvas.toDataURL("image/png")
        }
      }

      return null
    }, [...LOGIN_QRCODE_SELECTORS])
  } catch {
    return null
  }
}

async function anyFrameSelectorExists(
  frames: readonly Frame[],
  selectors: readonly string[],
): Promise<boolean> {
  for (const frame of frames) {
    for (const selector of selectors) {
      try {
        const handle = await frame.$(selector)
        if (handle) {
          await handle.dispose()
          return true
        }
      } catch {
        // ignore frame transition errors
      }
    }
  }
  return false
}

async function anyFrameTextIncludes(
  frames: readonly Frame[],
  texts: readonly string[],
): Promise<boolean> {
  for (const frame of frames) {
    try {
      const found = await frame.evaluate((candidates) => {
        const bodyText = document.body?.innerText?.replace(/\s+/g, " ") ?? ""
        return candidates.some((candidate) => bodyText.includes(candidate))
      }, [...texts])
      if (found) {
        return true
      }
    } catch {
      // ignore frame transition errors
    }
  }
  return false
}

async function loadImageBuffer(value: string): Promise<Buffer> {
  if (value.startsWith("data:image/")) {
    return Buffer.from(value.replace(/^data:image\/\w+;base64,/, ""), "base64")
  }

  const response = await fetch(value)
  if (!response.ok) {
    throw new Error(`Failed to download QR code image: ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
