/**
 * Diagnostic: inspect the Douyin login page DOM.
 * Usage: bun run --cwd plugins/douyin-poster test/inspect-login.ts
 */

import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 5_000))

// Dump all img elements
const imgs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("img")).map((img) => ({
    src: img.src?.slice(0, 80),
    className: img.className,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    id: img.id,
  }))
)
console.error("[imgs]", JSON.stringify(imgs, null, 2))

// Dump canvas elements
const canvases = await page.evaluate(() =>
  Array.from(document.querySelectorAll("canvas")).map((c) => ({
    className: c.className,
    id: c.id,
    width: c.width,
    height: c.height,
  }))
)
console.error("[canvases]", JSON.stringify(canvases, null, 2))

// Check body text for login signals
const bodyText = await page.evaluate(() =>
  document.body.innerText.replace(/\s+/g, " ").slice(0, 500)
)
console.error("[body text]", bodyText)

await managed.close()
