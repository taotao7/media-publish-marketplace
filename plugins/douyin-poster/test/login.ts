/**
 * Test: get Douyin login QR code and wait for scan.
 * Usage: bun run --cwd plugins/douyin-poster test/login.ts
 */

import { launchBrowser } from "../src/browser.js"
import { fetchQrcode, waitForLogin } from "../src/login.js"

const managed = await launchBrowser("default")

try {
  const result = await fetchQrcode(managed.page, "default")
  if (result.alreadyLoggedIn) {
    console.error("[test] already logged in")
    await managed.saveCookies()
    await managed.close()
    process.exit(0)
  }

  console.error('[test] browser login window opened; scan the QR code in the browser')

  const success = await waitForLogin(managed.page)
  if (success) {
    await managed.saveCookies()
    console.error("[test] login successful, cookies saved")
  } else {
    console.error("[test] login timed out")
    process.exit(1)
  }
} catch (err) {
  console.error("[test] failed:", err)
  process.exit(1)
} finally {
  await managed.close()
}
