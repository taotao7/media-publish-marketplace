/**
 * Diagnostic: click the correct 选择音乐 action span and observe result.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR, IMAGE_UPLOADED_INDICATOR_SELECTOR } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 4_000))

const tab = await page.$(IMAGE_TAB_SELECTOR)
if (tab) { await tab.click(); await new Promise((r) => setTimeout(r, 2_000)) }

const fileInput = await page.$("input[type='file'][accept*='image']")
if (!fileInput) { console.error("[error] no file input"); await managed.close(); process.exit(1) }

await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
  (fileInput as any).uploadFile("/Users/tao/Downloads/example/ScreenShot_2026-03-18_132442_748.png"),
])

const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
  if (count >= 1) { console.error("[ok] image uploaded"); break }
  await new Promise((r) => setTimeout(r, 1_000))
}

// Click the LAST 选择音乐 span (the action button on the right)
const clickResult = await page.evaluate(() => {
  // Find all spans with exactly "选择音乐" text, pick the LAST one (the action button)
  const spans = Array.from(document.querySelectorAll("span"))
    .filter(el => el.textContent?.trim() === "选择音乐")
    .filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  if (spans.length === 0) return { clicked: false, reason: "no span found" }
  const target = spans[spans.length - 1]  // last = action button
  ;(target as HTMLElement).click()
  return {
    clicked: true,
    tag: target.tagName,
    className: target.className,
    rect: { x: Math.round(target.getBoundingClientRect().x), y: Math.round(target.getBoundingClientRect().y) },
  }
})
console.error("[click result]", JSON.stringify(clickResult))
await new Promise((r) => setTimeout(r, 2_000))

// Check what opened
const state = await page.evaluate(() => {
  // Large visible elements that appeared (music picker)
  const newEls = Array.from(document.querySelectorAll("[class*='drawer'], [class*='panel'], [class*='modal']"))
    .filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 100 && r.height > 100
    })
    .map(el => ({
      tag: el.tagName,
      className: el.className.slice(0, 80),
      text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 150),
    }))

  // Music state
  const musicEls = Array.from(document.querySelectorAll("[class*='music']"))
    .filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    .map(el => ({
      className: el.className.slice(0, 60),
      text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 60),
    }))

  return { newEls, musicEls }
})
console.error("[picker/drawer opened]", JSON.stringify(state.newEls, null, 2))
console.error("[music state]", JSON.stringify(state.musicEls, null, 2))

const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400))
console.error("[body snippet]", body)

await managed.close()
