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
  "/Users/tao/Pictures/wallhaven-qr6z7d.jpg",
  "/Users/tao/Pictures/wallhaven-dgd1em.jpg",
  "/Users/tao/Pictures/wallhaven-eyz51o.jpg",
  "/Users/tao/Pictures/wallhaven-6lkdmq.jpg",
  "/Users/tao/Pictures/wallhaven-zy6g2v.jpg",
  "/Users/tao/Pictures/gruv-sushi-streets.jpg",
  "/Users/tao/Pictures/aj-robbie-BuQ1RZckYW4.jpg",
  "/Users/tao/Pictures/wallhaven-431zx6.png",
  "/Users/tao/Pictures/wallhaven-x6elml.png",
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
