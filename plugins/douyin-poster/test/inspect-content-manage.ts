/**
 * Diagnostic: find where scheduled/draft posts appear after publishing.
 */
import { launchBrowser } from "../src/browser.js"

const managed = await launchBrowser("default")
const page = managed.page

const URLS_TO_TRY = [
  "https://creator.douyin.com/creator-micro/content/manage",
  "https://creator.douyin.com/creator-micro/content/manage?content_type=image",
  "https://creator.douyin.com/creator-micro/content/post",
  "https://creator.douyin.com/creator-micro/content",
]

for (const url of URLS_TO_TRY) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await new Promise((r) => setTimeout(r, 3_000))
  console.error("\n[url]", page.url())
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500))
  console.error("[body]", text)
}

// Try clicking all filter tabs and look for scheduled content
await page.goto("https://creator.douyin.com/creator-micro/content/manage", {
  waitUntil: "domcontentloaded",
  timeout: 30_000,
})
await new Promise((r) => setTimeout(r, 3_000))

// Find ALL tab-like elements
const allTabs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[class*='tab'], [class*='filter']"))
    .map(el => el.textContent?.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
)
console.error("\n[all tab texts]", allTabs)

// Find content type switcher (视频/图文/etc)
const contentTypeSwitcher = await page.evaluate(() =>
  Array.from(document.querySelectorAll("*"))
    .filter(el => {
      const t = el.textContent?.trim() ?? ""
      return (t === "图文" || t === "视频" || t === "直播") && el.children.length <= 1
    })
    .map(el => ({ tag: el.tagName, className: el.className, text: el.textContent?.trim() }))
)
console.error("[content type switcher elements]", JSON.stringify(contentTypeSwitcher, null, 2))

await managed.close()
