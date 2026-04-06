/**
 * Test: publish a Bilibili video with the local plugin implementation.
 * Usage:
 *   BILIBILI_VIDEO_PATH=/abs/video.mp4 \
 *   BILIBILI_TITLE='测试投稿' \
 *   BILIBILI_SCHEDULE_MINUTES=180 \
 *   bun run --cwd plugins/bilibili-poster test/publish-video.ts
 */

import { launchBrowser } from "../src/browser.js"
import { publishVideo } from "../src/publish.js"

const videoPath = process.env.BILIBILI_VIDEO_PATH
const title = process.env.BILIBILI_TITLE || "测试投稿"
const description = process.env.BILIBILI_DESCRIPTION
const tags = process.env.BILIBILI_TAGS
  ? process.env.BILIBILI_TAGS.split(",").map((item) => item.trim()).filter(Boolean)
  : undefined
const category = process.env.BILIBILI_CATEGORY
const copyright =
  process.env.BILIBILI_COPYRIGHT === "repost" ? "repost" : "original"
const source = process.env.BILIBILI_SOURCE
const scheduleAt =
  process.env.BILIBILI_SCHEDULE_AT ??
  (process.env.BILIBILI_SCHEDULE_MINUTES
    ? new Date(
        Date.now() + Number(process.env.BILIBILI_SCHEDULE_MINUTES) * 60 * 1000,
      ).toISOString()
    : undefined)
const submitModeEnv = process.env.BILIBILI_SUBMIT_MODE
const submitMode =
  submitModeEnv === "draft"
    ? "draft"
    : submitModeEnv === "schedule" || scheduleAt
      ? "schedule"
      : "publish"

if (!videoPath) {
  throw new Error("Set BILIBILI_VIDEO_PATH to a local video file first")
}

const managed = await launchBrowser("default")

try {
  await publishVideo(managed.page, {
    title,
    description,
    videoPath,
    tags,
    category,
    copyright,
    source,
    scheduleAt,
    submitMode,
  })
  await managed.saveCookies()
  console.error("[test] publish flow completed")
} catch (error) {
  console.error("[test] publish failed:", error)
  process.exit(1)
} finally {
  await managed.close()
}
