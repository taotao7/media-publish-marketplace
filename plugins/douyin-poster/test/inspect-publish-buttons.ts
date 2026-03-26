/**
 * Diagnostic: dump all buttons on the image post form to find the actual submit button.
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

// Wait for thumbnail
const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
  if (count >= 1) { console.error("[ok] image uploaded"); break }
  await new Promise((r) => setTimeout(r, 1_000))
}

// Fill title
await page.evaluate(() => {
  const input = document.querySelector("input[placeholder*='标题']") as HTMLInputElement | null
  if (input) { input.value = "诊断测试"; input.dispatchEvent(new Event("input", { bubbles: true })) }
})
await new Promise((r) => setTimeout(r, 500))

// Dump ALL buttons with full info
const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button, [role='button']")).map(el => {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return {
      tag: el.tagName,
      text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 60),
      className: el.className.slice(0, 80),
      disabled: (el as HTMLButtonElement).disabled || el.hasAttribute("disabled"),
      display: style.display,
      visibility: style.visibility,
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    }
  })
)
console.error("[all buttons]", JSON.stringify(buttons, null, 2))

// Check what clickByTexts would match for ["发布", "立即发布", "发布作品"]
const clickMatch = await page.evaluate((candidates) => {
  const elements = Array.from(document.querySelectorAll("button, [role='button'], label, span, div, a"))
  const isVisible = (el: Element) => {
    const s = window.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0
  }
  for (const el of elements) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (!text || !isVisible(el)) continue
    if (candidates.some((c: string) => text === c || text.includes(c))) {
      return { tag: el.tagName, className: el.className.slice(0, 80), text: text.slice(0, 60) }
    }
  }
  return null
}, ["发布", "立即发布", "发布作品"])
console.error("[clickByTexts would click]", JSON.stringify(clickMatch))

await managed.close()
