/**
 * Diagnostic: find drafts/scheduled posts management page.
 * Usage: bun run --cwd plugins/douyin-poster test/inspect-drafts.ts
 */

import { launchBrowser } from "../src/browser.js"

const managed = await launchBrowser("default")
const page = managed.page

const URLS_TO_TRY = [
  "https://creator.douyin.com/creator-micro/content/manage",
  "https://creator.douyin.com/creator-micro/content/manage?tab=draft",
  "https://creator.douyin.com/creator-micro/content/manage?status=draft",
]

for (const url of URLS_TO_TRY) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await new Promise((r) => setTimeout(r, 3_000))
  console.error("[url]", page.url())
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300))
  console.error("[body]", text)

  // Look for status filter tabs
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[class*='tab'], [class*='filter'], [role='tab']"))
      .map(el => ({ className: el.className.slice(0, 60), text: el.textContent?.trim().slice(0, 40) }))
      .filter(t => t.text)
  )
  console.error("[tabs]", JSON.stringify(tabs))
  console.error("---")
}

// Also try clicking any tab that mentions 草稿/定时
const clicked = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("*"))
  for (const el of els) {
    const t = el.textContent?.trim() ?? ""
    if ((t === "草稿" || t === "定时发布" || t === "未发布") && el.children.length <= 1) {
      ;(el as HTMLElement).click()
      return t
    }
  }
  return null
})
console.error("[clicked tab]", clicked)

if (clicked) {
  await new Promise((r) => setTimeout(r, 2_000))
  console.error("[url after tab]", page.url())

  // Find post cards
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[class*='card'], [class*='item-wrap'], [class*='work']"))
      .slice(0, 5)
      .map(el => ({
        className: el.className.slice(0, 60),
        text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
        html: el.outerHTML.slice(0, 300),
      }))
  )
  console.error("[post cards]", JSON.stringify(cards, null, 2))
}

await managed.close()
