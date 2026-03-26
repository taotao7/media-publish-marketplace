/**
 * Inspect tag input on image post form.
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

// Find tag-related inputs
const tagInputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("input, [contenteditable]"))
    .map(el => ({
      tag: el.tagName,
      placeholder: (el as HTMLInputElement).placeholder ?? el.getAttribute("data-placeholder") ?? "",
      className: el.className.slice(0, 60),
      type: (el as HTMLInputElement).type ?? "",
      visible: el.getBoundingClientRect().width > 0,
    }))
    .filter(el => el.visible)
)
console.error("[all visible inputs]", JSON.stringify(tagInputs, null, 2))

// Find "添加标签" section
const tagSection = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("*"))
  for (const el of els) {
    if (el.textContent?.trim() === "添加标签" && el.children.length <= 1) {
      return {
        tag: el.tagName,
        className: el.className.slice(0, 60),
        parentHTML: el.parentElement?.outerHTML.slice(0, 500),
      }
    }
  }
  return null
})
console.error("[添加标签 element]", JSON.stringify(tagSection, null, 2))

await managed.close()
