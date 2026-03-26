/**
 * Inspect the 使用 button structure inside music picker.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR, IMAGE_UPLOADED_INDICATOR_SELECTOR, MUSIC_PICKER_SELECTOR } from "../src/selectors.js"

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

// Open music picker
await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll("span"))
    .filter(el => el.textContent?.trim() === "选择音乐" && el.getBoundingClientRect().width > 0)
  if (spans.length > 0) (spans[spans.length - 1] as HTMLElement).click()
})
await page.waitForSelector(MUSIC_PICKER_SELECTOR, { timeout: 5_000 }).catch(() => {})
await new Promise((r) => setTimeout(r, 2_000))

// Dump buttons and spans inside the picker
const pickerContent = await page.evaluate((sel) => {
  const picker = document.querySelector(sel)
  if (!picker) return null

  const btns = Array.from(picker.querySelectorAll("button, [role='button']")).map(el => ({
    tag: el.tagName,
    text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 40),
    className: el.className.slice(0, 60),
    visible: el.getBoundingClientRect().width > 0,
  }))

  const spans = Array.from(picker.querySelectorAll("span"))
    .filter(el => el.textContent?.trim() === "使用")
    .map(el => ({
      text: el.textContent?.trim(),
      className: el.className.slice(0, 60),
      parentTag: el.parentElement?.tagName,
      parentClass: el.parentElement?.className.slice(0, 60),
      visible: el.getBoundingClientRect().width > 0,
      rect: { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) },
    }))

  // First track item HTML
  const firstTrack = picker.querySelector("[class*='music-item'], [class*='track'], [class*='song']")

  return { btns, useSpans: spans, firstTrackHTML: firstTrack?.outerHTML.slice(0, 400) }
}, MUSIC_PICKER_SELECTOR)
console.error("[picker buttons]", JSON.stringify(pickerContent?.btns, null, 2))
console.error("[使用 spans]", JSON.stringify(pickerContent?.useSpans, null, 2))
console.error("[first track HTML]", pickerContent?.firstTrackHTML)

await managed.close()
