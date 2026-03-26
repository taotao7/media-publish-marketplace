/**
 * Test: publish an image post (图文) to Douyin.
 * Usage: bun run --cwd plugins/douyin-poster test/publish-images.ts
 *
 * Set DOUYIN_HEADLESS=false to watch the browser.
 */

import { launchBrowser } from "../src/browser.js"
import { publishImages } from "../src/publish.js"

const TEST_IMAGES = [
  "/Users/tao/Pictures/wallhaven-qdyxlq.jpg",
]

const managed = await launchBrowser("default")

try {
// Schedule 10 minutes from now
const scheduleAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

await publishImages(managed.page, {
    title: "测试图文定时发布",
    content: "这是一条定时发送的测试图文，测试完成后可以删除。",
    imagePaths: TEST_IMAGES,
    tags: ["测试"],
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
