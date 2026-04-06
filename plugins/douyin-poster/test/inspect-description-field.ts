import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR } from "../src/selectors.js"

const MODE = process.env.DOUYIN_MODE ?? "image"
const IMAGE_PATH = process.env.DOUYIN_IMAGE_PATH ?? "/Users/tao/Pictures/wallhaven-qdyxlq.jpg"
const VIDEO_PATH =
  process.env.DOUYIN_VIDEO_PATH ??
  "/Users/tao/workspace/side_project/media-publish-marketplace/.tmp/douyin-test-video.mp4"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((resolve) => setTimeout(resolve, 4_000))

if (MODE === "image") {
  const tab = await page.$(IMAGE_TAB_SELECTOR)
  if (tab) {
    await tab.click()
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }

  const input = await page.$("input[type='file'][accept*='image']")
  if (!input) {
    throw new Error("image input not found")
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
    input.uploadFile(IMAGE_PATH),
  ])
  await new Promise((resolve) => setTimeout(resolve, 4_000))
} else {
  const input = await page.$("input[type='file'][accept*='video']") ?? await page.$("input[type='file']")
  if (!input) {
    throw new Error("video input not found")
  }

  await input.uploadFile(VIDEO_PATH)
  await new Promise((resolve) => setTimeout(resolve, 6_000))
}

const before = await page.evaluate(() =>
  Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [contenteditable='plaintext-only']"))
    .filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    .map((el) => {
      const htmlEl = el as HTMLElement
      return {
        tag: el.tagName,
        className: htmlEl.className.slice(0, 120),
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        dataPlaceholder: htmlEl.getAttribute("data-placeholder") ?? "",
        ariaLabel: htmlEl.getAttribute("aria-label") ?? "",
        textContent: (htmlEl.innerText || htmlEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
        outerHTML: htmlEl.outerHTML.slice(0, 300),
      }
    }),
)
console.error("[before fill]", JSON.stringify(before, null, 2))

await page.evaluate(() => {
  const target =
    (document.querySelector("textarea[placeholder*='简介']") as HTMLTextAreaElement | null) ??
    (document.querySelector("textarea[placeholder*='描述']") as HTMLTextAreaElement | null) ??
    (document.querySelector("[contenteditable='true']") as HTMLElement | null)

  if (!target) {
    return
  }

  if (target instanceof HTMLTextAreaElement) {
    target.value = "描述诊断文本 #测试"
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
    return
  }

  target.textContent = "描述诊断文本 #测试"
  target.dispatchEvent(new Event("input", { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 1_500))

const after = await page.evaluate(() =>
  Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [contenteditable='plaintext-only']"))
    .filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    .map((el) => {
      const htmlEl = el as HTMLElement
      return {
        tag: el.tagName,
        className: htmlEl.className.slice(0, 120),
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        dataPlaceholder: htmlEl.getAttribute("data-placeholder") ?? "",
        ariaLabel: htmlEl.getAttribute("aria-label") ?? "",
        textContent: (htmlEl.innerText || htmlEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
        outerHTML: htmlEl.outerHTML.slice(0, 300),
      }
    }),
)
console.error("[after fill]", JSON.stringify(after, null, 2))

await managed.close()
