/**
 * Diagnostic: verify schedule radio click and date input.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR, IMAGE_UPLOADED_INDICATOR_SELECTOR, SCHEDULE_RADIO_TEXT, SCHEDULE_INPUT_SELECTOR } from "../src/selectors.js"

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

// Find 定时发布 radio elements
const radioEls = await page.evaluate((text) =>
  Array.from(document.querySelectorAll("span, label, div"))
    .filter(el => el.textContent?.trim() === text)
    .map(el => ({
      tag: el.tagName,
      className: el.className,
      childrenCount: el.children.length,
      parentHTML: el.parentElement?.outerHTML.slice(0, 200),
    }))
, SCHEDULE_RADIO_TEXT)
console.error("[定时发布 elements]", JSON.stringify(radioEls, null, 2))

// Click "定时发布"
const clicked = await page.evaluate((text) => {
  const els = Array.from(document.querySelectorAll("span, label, div"))
  for (const el of els) {
    if (el.textContent?.trim() === text && el.children.length <= 1) {
      ;(el as HTMLElement).click()
      return { tag: el.tagName, className: el.className }
    }
  }
  return null
}, SCHEDULE_RADIO_TEXT)
console.error("[clicked 定时发布]", JSON.stringify(clicked))
await new Promise((r) => setTimeout(r, 1_000))

// Check if date input appeared
const dateInput = await page.$(SCHEDULE_INPUT_SELECTOR)
console.error("[date input found]", !!dateInput)

if (dateInput) {
  const placeholder = await dateInput.evaluate((el) => (el as HTMLInputElement).placeholder)
  console.error("[date input placeholder]", placeholder)

  // Try typing date
  const formatted = (() => {
    const d = new Date(Date.now() + 3 * 60 * 60 * 1000) // 3h from now
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
  })()
  console.error("[typing formatted date]", formatted)

  await dateInput.click({ clickCount: 3 })
  await new Promise((r) => setTimeout(r, 200))
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })) }
  }, SCHEDULE_INPUT_SELECTOR)
  await dateInput.type(formatted, { delay: 30 })
  await page.keyboard.press("Enter")
  await new Promise((r) => setTimeout(r, 1_000))

  const inputValue = await dateInput.evaluate((el) => (el as HTMLInputElement).value)
  console.error("[date input value after typing]", inputValue)
} else {
  // No input found — check what appeared in the schedule section
  const scheduleSection = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*"))
    for (const el of els) {
      if (el.textContent?.includes("发布时间") && el.children.length > 1) {
        return el.outerHTML.slice(0, 600)
      }
    }
    return null
  })
  console.error("[schedule section HTML]", scheduleSection)
}

await managed.close()
