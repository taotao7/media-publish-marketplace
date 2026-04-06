/**
 * Diagnostic: inspect titles on the Bilibili draft manager page.
 * Usage: bun run --cwd plugins/bilibili-poster test/inspect-drafts.ts
 */

import { launchBrowser } from "../src/browser.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto("https://member.bilibili.com/platform/upload-manager/article?group=draft", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
})
await new Promise((resolve) => setTimeout(resolve, 5_000))

const drafts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a, div, span"))
    .map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
      className: (node as HTMLElement).className,
    }))
    .filter(
      (item) =>
        item.text.length > 0 &&
        item.text.length < 160 &&
        (item.text.includes("Codex") || item.text.includes("douyin-test-video")),
    )
    .slice(0, 100),
)

console.error("[drafts]", JSON.stringify(drafts, null, 2))

await managed.close()
