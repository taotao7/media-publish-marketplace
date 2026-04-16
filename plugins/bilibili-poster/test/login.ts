/**
 * Test: get Bilibili login QR code and wait for scan.
 * Usage: bun run --cwd plugins/bilibili-poster test/login.ts
 */

import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus, fetchQrcode } from "../src/login.js"

const managed = await launchBrowser("default")
const page = managed.page

page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) {
    console.error(`[test] main frame navigated: ${frame.url()}`)
  }
})

page.on("pageerror", (error) => {
  console.error("[test] pageerror:", error)
})

page.on("close", () => {
  console.error("[test] page closed")
})

try {
  const result = await fetchQrcode(page, "default")
  if (result.alreadyLoggedIn) {
    console.error("[test] already logged in")
    await managed.saveCookies()
    await managed.close()
    process.exit(0)
  }

  console.error("[test] browser login window opened; scan the QR code in the browser")

  const deadline = Date.now() + 240_000
  let lastStatusUrl = ""

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("Page was closed before login completed")
    }

    const status = await detectLoginStatus(page)
    if (status.currentUrl !== lastStatusUrl) {
      lastStatusUrl = status.currentUrl
      console.error(`[test] login poll url: ${status.currentUrl}`)
    }

    if (status.loggedIn) {
      await managed.saveCookies()
      console.error("[test] login successful, cookies saved")
      process.exit(0)
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  console.error("[test] login timed out")
  process.exit(1)
} catch (err) {
  console.error("[test] failed:", err)
  process.exit(1)
} finally {
  await managed.close()
}
