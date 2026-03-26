/**
 * Diagnostic: observe page state after clicking 发布 on an image post.
 * Does NOT actually submit — checks for errors or success indicators.
 */
import { launchBrowser } from "../src/browser.js"
import { publishImages } from "../src/publish.js"

const managed = await launchBrowser("default")

// Use schedule 2hr from now to avoid accidental publish
const scheduleAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

try {
  await publishImages(managed.page, {
    title: "诊断测试帖",
    content: "测试内容",
    imagePaths: ["/Users/tao/Downloads/example/ScreenShot_2026-03-18_132442_748.png"],
    tags: ["测试"],
    visibility: "private",
    scheduleAt,
  })
  console.error("[publishImages returned without error]")
} catch (err) {
  console.error("[publishImages threw]", err)
}

// After publish, check what page we're on
console.error("[url after publish]", managed.page.url())
const body = await managed.page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600))
console.error("[body after publish]", body)

// Look for success/error elements
const indicators = await managed.page.evaluate(() => {
  const successTexts = ["发布成功", "提交成功", "已发布", "定时发布成功", "已安排发布"]
  const errorTexts = ["发布失败", "提交失败", "错误", "请填写", "不能为空"]
  const found: { type: string; text: string; tag: string }[] = []
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const text = el.textContent?.trim() ?? ""
    if (!text || el.children.length > 2) continue
    if (successTexts.some(s => text.includes(s))) {
      found.push({ type: "success", text: text.slice(0, 80), tag: el.tagName })
    }
    if (errorTexts.some(s => text.includes(s))) {
      found.push({ type: "error", text: text.slice(0, 80), tag: el.tagName })
    }
  }
  return found.slice(0, 10)
})
console.error("[success/error indicators]", JSON.stringify(indicators, null, 2))

await managed.saveCookies()
await managed.close()
