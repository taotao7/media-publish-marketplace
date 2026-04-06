/**
 * Test: publish an image post (图文) to Douyin.
 * Usage: bun run --cwd plugins/douyin-poster test/publish-images.ts
 *
 * Set DOUYIN_HEADLESS=false to watch the browser.
 */

import { launchBrowser } from "../src/browser.js"
import { publishImages } from "../src/publish.js"

const TEST_IMAGES = [
  process.env.DOUYIN_IMAGE_PATH ?? "/Users/tao/Pictures/wallhaven-qdyxlq.jpg",
]
const SCHEDULE_MINUTES = Number(process.env.DOUYIN_SCHEDULE_MINUTES ?? "180")
const scheduleAt = new Date(Date.now() + SCHEDULE_MINUTES * 60 * 1000).toISOString()

const managed = await launchBrowser("default")

try {
  await publishImages(managed.page, {
    title: "日常分享",
    content: "分享一些工作日常",
    imagePaths: TEST_IMAGES,
    tags: ["效率工具", "工作流", "生产力", "AI工具", "日常分享"],
    visibility: "private",
    scheduleAt,
  })
  await managed.saveCookies()
  console.error("[test] image post published successfully")
} catch (err) {
  console.error("[test] failed:", err)
  process.exit(1)
} finally {
  await managed.close()
}
