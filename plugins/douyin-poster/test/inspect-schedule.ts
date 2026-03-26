/**
 * Diagnostic: inspect schedule UI on the image post page.
 * Usage: bun run --cwd plugins/douyin-poster test/inspect-schedule.ts
 */

import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

// Navigate and switch to image tab
await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 4_000))

const tab = await page.$(IMAGE_TAB_SELECTOR)
if (tab) { await tab.click(); await new Promise((r) => setTimeout(r, 2_000)) }

// Upload a test image to get to the full form
const input = await page.$("input[type='file'][accept*='image']")
if (input) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
    (input as any).uploadFile("/Users/tao/Pictures/wallhaven-qdyxlq.jpg"),
  ])
  await new Promise((r) => setTimeout(r, 3_000))
}

console.error("[url]", page.url())

// Find schedule-related elements
const scheduleEls = await page.evaluate(() =>
  Array.from(document.querySelectorAll("*"))
    .filter(el => {
      const text = el.textContent?.trim() ?? ""
      return el.children.length <= 2 && (text === "定时发布" || text === "立即发布" || text === "发布时间")
    })
    .map(el => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.trim(),
      parentClass: (el.parentElement?.className ?? "").slice(0, 80),
    }))
)
console.error("[schedule elements]", JSON.stringify(scheduleEls, null, 2))

// Click "定时发布" to reveal the date picker
const clicked = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("*"))
  for (const el of els) {
    if (el.textContent?.trim() === "定时发布" && el.children.length <= 1) {
      ;(el as HTMLElement).click()
      return el.className
    }
  }
  return null
})
console.error("[clicked 定时发布]", clicked)
await new Promise((r) => setTimeout(r, 1_500))

// Inspect the date/time picker that appeared
const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("input")).map(el => ({
    type: el.type,
    placeholder: el.placeholder,
    value: el.value,
    className: el.className,
    name: el.name,
  }))
)
console.error("[inputs after 定时发布 click]", JSON.stringify(inputs, null, 2))

// Any new elements with date/time-like content
const dateEls = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[class*='date'], [class*='time'], [class*='picker'], [class*='schedule']"))
    .map(el => ({
      tag: el.tagName,
      className: el.className.slice(0, 80),
      html: el.outerHTML.slice(0, 200),
    }))
)
console.error("[date/time elements]", JSON.stringify(dateEls, null, 2))

await managed.close()
