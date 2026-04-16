import { existsSync } from "node:fs"
import type { Browser, CookieParam, Page } from "puppeteer"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { loadCookies, saveCookies } from "./cookies.js"

puppeteer.use(StealthPlugin())

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"

export interface ManagedBrowser {
  readonly page: Page
  readonly saveCookies: () => Promise<void>
  readonly close: () => Promise<void>
}

export interface LaunchBrowserOptions {
  readonly headless?: boolean
}

export async function launchBrowser(
  account: string,
  options: LaunchBrowserOptions = {},
): Promise<ManagedBrowser> {
  const headless = options.headless ?? (process.env.DOUYIN_HEADLESS !== "false")
  const executablePath = resolveExecutablePath()

  const browser = (await puppeteer.launch({
    executablePath,
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })) as Browser

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 960 })
  await page.setUserAgent(DEFAULT_USER_AGENT)
  await page.setExtraHTTPHeaders({
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  })
  page.setDefaultNavigationTimeout(60_000)
  page.setDefaultTimeout(30_000)

  const cookies = await loadCookies(account)
  if (cookies.length > 0) {
    await page.setCookie(...(cookies as CookieParam[]))
  }

  return {
    page,
    saveCookies: async () => {
      const client = await page.createCDPSession()
      const { cookies: allCookies } = await client.send("Network.getAllCookies")
      await saveCookies(allCookies as CookieParam[], account)
    },
    close: async () => {
      await page.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}

function resolveExecutablePath(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}
