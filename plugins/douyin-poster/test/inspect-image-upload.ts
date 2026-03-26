/**
 * Diagnostic: inspect the image upload page after clicking image tab.
 * Usage: bun run --cwd plugins/douyin-poster test/inspect-image-upload.ts
 */

import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 5_000))

// Click image tab
const tab = await page.$(IMAGE_TAB_SELECTOR)
if (tab) {
  console.error("[tab] found, clicking")
  await tab.click()
  await new Promise((r) => setTimeout(r, 3_000))
} else {
  console.error("[tab] not found with selector, trying text")
}

// Upload a test image
const input = await page.$("input[type='file'][accept*='image']")
if (input) {
  console.error("[upload] uploading test image")
  await (input as any).uploadFile("/Users/tao/Pictures/wallhaven-qdyxlq.jpg")
  await new Promise((r) => setTimeout(r, 5_000))

  // Dump any img elements that appeared after upload
  const imgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img")).map((img) => ({
      src: (img as HTMLImageElement).src?.slice(0, 60),
      className: img.className,
      naturalWidth: (img as HTMLImageElement).naturalWidth,
      naturalHeight: (img as HTMLImageElement).naturalHeight,
    })).filter(i => i.naturalWidth > 0)
  )
  console.error("[imgs after upload]", JSON.stringify(imgs, null, 2))
} else {
  console.error("[upload] image file input not found")
}

await managed.close()
