/**
 * Diagnostic: inspect the Bilibili upload editor after a local file upload.
 * Usage: BILIBILI_VIDEO_PATH=/abs/video.mp4 bun run --cwd plugins/bilibili-poster test/inspect-upload.ts
 */

import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const videoPath = process.env.BILIBILI_VIDEO_PATH
if (!videoPath) {
  throw new Error("Set BILIBILI_VIDEO_PATH to a local video file first")
}

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((resolve) => setTimeout(resolve, 5_000))

const status = await detectLoginStatus(page)
console.error("[login status]", status)
if (!status.loggedIn) {
  throw new Error("Not logged in. Run test/login.ts first.")
}

const input =
  (await page.$("input[type='file'][accept*='video']")) ??
  (await page.$("input[type='file']"))
if (!input) {
  throw new Error("file input not found")
}

await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
  input.uploadFile(videoPath),
])

await new Promise((resolve) => setTimeout(resolve, 10_000))

console.error("[url after upload]", page.url())

const snapshot = await page.evaluate(() => {
  const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 2000) ?? ""
  const inputs = Array.from(document.querySelectorAll("input, textarea")).map((node) => ({
    tag: node.tagName,
    type: (node as HTMLInputElement).type ?? "",
    placeholder: (node as HTMLInputElement).placeholder ?? "",
    value: (node as HTMLInputElement).value?.slice(0, 120) ?? "",
    className: node.className,
  }))
  const editable = Array.from(document.querySelectorAll("[contenteditable='true']")).map((node) => ({
    className: (node as HTMLElement).className,
    text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "",
  }))
  const buttons = Array.from(document.querySelectorAll("button, div, span, a, li"))
    .map((node) => ({
      tag: node.tagName,
      className: (node as HTMLElement).className,
      text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, 400)

  return { bodyText, inputs, editable, buttons }
})

console.error("[snapshot]", JSON.stringify(snapshot, null, 2))

await managed.close()
