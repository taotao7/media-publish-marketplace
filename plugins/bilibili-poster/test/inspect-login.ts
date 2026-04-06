/**
 * Diagnostic: inspect the Bilibili login page DOM and frame structure.
 * Usage: bun run --cwd plugins/bilibili-poster test/inspect-login.ts
 */

import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((resolve) => setTimeout(resolve, 5_000))

console.error("[url]", page.url())
console.error(
  "[frames]",
  JSON.stringify(
    page.frames().map((frame) => frame.url()),
    null,
    2,
  ),
)

const snapshot = await page.evaluate(() => {
  const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 1000) ?? ""
  const imgs = Array.from(document.querySelectorAll("img")).map((img) => ({
    src: img.src?.slice(0, 120),
    className: img.className,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }))
  const canvases = Array.from(document.querySelectorAll("canvas")).map((canvas) => ({
    className: canvas.className,
    width: canvas.width,
    height: canvas.height,
  }))
  const inputs = Array.from(document.querySelectorAll("input")).map((input) => ({
    type: input.type,
    accept: input.accept,
    placeholder: input.placeholder,
    className: input.className,
  }))
  const buttons = Array.from(document.querySelectorAll("button, div, span, a"))
    .map((node) => ({
      tag: node.tagName,
      className: (node as HTMLElement).className,
      text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, 200)

  return { bodyText, imgs, canvases, inputs, buttons }
})

console.error("[snapshot]", JSON.stringify(snapshot, null, 2))

await managed.close()
