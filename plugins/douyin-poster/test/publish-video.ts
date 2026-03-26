import { launchBrowser } from "../src/browser.js"
import { publishVideo } from "../src/publish.js"

const ACCOUNT = process.env.DOUYIN_ACCOUNT ?? "default"
const VIDEO_PATH =
  process.env.DOUYIN_VIDEO_PATH ??
  "/Users/tao/Desktop/Screen Recording 2026-03-26 at 10.59.31.mov"
const SCHEDULE_MINUTES = Number(process.env.DOUYIN_SCHEDULE_MINUTES ?? "150")

const scheduleAt = new Date(Date.now() + SCHEDULE_MINUTES * 60 * 1000).toISOString()

const managed = await launchBrowser(ACCOUNT)

try {
  console.error(`[run] account=${ACCOUNT}`)
  console.error(`[run] video=${VIDEO_PATH}`)
  console.error(`[run] schedule_at=${scheduleAt}`)

  await publishVideo(managed.page, {
    title: "这段录屏记录了我最近的工作流",
    content:
      "把最近常用的工具顺了一遍，留给自己以后回看，也分享给同样在整理效率习惯的朋友。",
    videoPath: VIDEO_PATH,
    tags: ["效率工具", "工作流"],
    visibility: "private",
    scheduleAt,
  })

  await managed.saveCookies()
  console.error("[ok] video flow completed")
} catch (err) {
  console.error("[fail] publish flow error:", err)
  process.exit(1)
} finally {
  await managed.close()
}
