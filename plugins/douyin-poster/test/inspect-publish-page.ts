/**
 * Diagnostic: inspect the full image publish page after upload.
 * Usage: bun run --cwd plugins/douyin-poster test/inspect-publish-page.ts
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
  await tab.click()
  await new Promise((r) => setTimeout(r, 3_000))
}
console.error("[url after tab click]", page.url())

// Upload image
const input = await page.$("input[type='file'][accept*='image']")
if (input) {
  await (input as any).uploadFile("/Users/tao/Pictures/wallhaven-qdyxlq.jpg")
  await new Promise((r) => setTimeout(r, 5_000))
}
console.error("[url after upload]", page.url())

// Check image selectors
for (const sel of [
  "img[src*='creator-media-private.douyin.com']",
  "img[src*='douyinpic.com/tos-cn-i']",
]) {
  const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel)
  console.error(`[img selector] "${sel}" → ${count} matches`)
}

// Find all elements with music-related text
const musicEls = await page.evaluate(() =>
  Array.from(document.querySelectorAll("*")).filter(el =>
    el.children.length === 0 && (el.textContent ?? "").includes("音乐")
  ).map(el => ({
    tag: el.tagName,
    className: el.className,
    text: el.textContent?.trim().slice(0, 50),
    parentClass: (el.parentElement?.className ?? "").slice(0, 60),
  }))
)
console.error("[music elements]", JSON.stringify(musicEls, null, 2))

// Dump upload-related DOM
const uploadArea = await page.evaluate(() => {
  const area = document.querySelector("[class*='upload']") ?? document.querySelector("[class*='image']")
  return area ? area.innerHTML.slice(0, 500) : "not found"
})
console.error("[upload area html]", uploadArea)

await managed.close()
