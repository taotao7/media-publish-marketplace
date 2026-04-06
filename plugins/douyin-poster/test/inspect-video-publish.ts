/**
 * Inspect video publish flow — check URL and state after each step.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, TITLE_INPUT_SELECTORS, DESCRIPTION_INPUT_SELECTORS, PUBLISH_BUTTON_SELECTORS } from "../src/selectors.js"

const VIDEO_PATH =
  process.env.DOUYIN_VIDEO_PATH ??
  "/Users/tao/Desktop/Screen Recording 2026-03-26 at 10.59.31.mov"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 5_000))
console.error("[url after goto]", page.url())

// Find and upload video file input
const videoInput = await page.$("input[type='file'][accept*='video']") ?? await page.$("input[type='file']")
if (!videoInput) { console.error("[error] no video input"); await managed.close(); process.exit(1) }
console.error("[uploading video...]")
await (videoInput as any).uploadFile(VIDEO_PATH)
console.error("[upload started]")

// Wait for editor to be ready (title OR description input appears)
const deadline = Date.now() + 300_000
let editorReady = false
while (Date.now() < deadline) {
  const titleEl = await page.$("input[placeholder*='标题']")
  const descEl = await page.$("[contenteditable='true']")
  const progressEl = await page.$("[class*='progress'], [class*='percent']")
  const progressText = progressEl ? await progressEl.evaluate(el => el.textContent?.trim()) : null

  console.error(`[poll] title=${!!titleEl} desc=${!!descEl} progress="${progressText ?? ''}" url=${page.url().slice(-40)}`)

  if ((titleEl || descEl) && !progressText) {
    editorReady = true
    console.error("[editor ready!]")
    break
  }
  await new Promise((r) => setTimeout(r, 3_000))
}

if (!editorReady) { console.error("[error] editor never ready"); await managed.close(); process.exit(1) }

// Fill title
await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll("input"))
  for (const input of inputs) {
    if (input.placeholder.includes("标题") && input.getBoundingClientRect().width > 0) {
      input.value = "我的工作流分享"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      return
    }
  }
})
await new Promise((r) => setTimeout(r, 500))

// Dump all buttons
const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button, [role='button']"))
    .filter(el => el.getBoundingClientRect().width > 0)
    .map(el => ({
      text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 40),
      className: el.className.slice(0, 80),
      disabled: (el as HTMLButtonElement).disabled,
    }))
)
console.error("[buttons on page]", JSON.stringify(buttons, null, 2))

const mediaState = await page.evaluate(() => ({
  url: location.href,
  videos: Array.from(document.querySelectorAll("video")).map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      className: el.className.slice(0, 80),
      src: (el as HTMLVideoElement).src.slice(0, 120),
      visible: rect.width > 0 && rect.height > 0,
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    }
  }),
  canvases: Array.from(document.querySelectorAll("canvas")).map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      className: el.className.slice(0, 80),
      visible: rect.width > 0 && rect.height > 0,
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    }
  }),
  images: Array.from(document.querySelectorAll("img"))
    .map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        className: el.className.slice(0, 80),
        src: el.src.slice(0, 120),
        visible: rect.width > 0 && rect.height > 0,
        size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      }
    })
    .filter((item) => item.visible)
    .slice(0, 12),
  textHints: Array.from(document.querySelectorAll("div, span, p"))
    .filter((el) => el.children.length <= 1)
    .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(
      (text) =>
        text.length > 0 &&
        text.length <= 120 &&
        (text.includes("上传") || text.includes("处理中") || text.includes("封面")),
    )
    .slice(0, 20),
}))
console.error("[media state]", JSON.stringify(mediaState, null, 2))

// Check which PUBLISH_BUTTON_SELECTORS match
for (const sel of PUBLISH_BUTTON_SELECTORS) {
  const el = await page.$(sel)
  if (el) {
    const info = await el.evaluate(e => ({
      text: e.textContent?.trim(),
      className: e.className.slice(0, 80),
      disabled: (e as HTMLButtonElement).disabled,
      visible: e.getBoundingClientRect().width > 0,
    }))
    console.error(`[selector "${sel}" matches]`, JSON.stringify(info))
  } else {
    console.error(`[selector "${sel}" → no match]`)
  }
}

await managed.close()
