/**
 * Batch schedule: 2 image posts + 1 video, all private, staggered 30min apart.
 * Usage: bun run --cwd plugins/douyin-poster test/schedule-batch.ts
 */

import { launchBrowser } from "../src/browser.js"
import { publishImages, publishVideo } from "../src/publish.js"

type Task =
  | { type: "images"; title: string; content: string; imagePaths: string[]; tags: string[]; minutesFromNow: number }
  | { type: "video"; title: string; content: string; videoPath: string; tags: string[]; minutesFromNow: number }

const TASKS: Task[] = [
  {
    type: "images",
    title: "春日碎片 | 随手记录的那些瞬间",
    content: "有些画面不需要滤镜，光线刚好，心情也刚好。",
    imagePaths: [
      "/Users/tao/Downloads/example/ScreenShot_2026-03-18_132442_748.png",
      "/Users/tao/Downloads/example/ScreenShot_2026-03-18_135002_880.png",
    ],
    tags: ["日常", "随手拍"],
    minutesFromNow: 150,
  },
  {
    type: "images",
    title: "今天的光线太好了，不拍一张可惜",
    content: "下午四点的斜阳，打在窗台上，安静又好看。",
    imagePaths: [
      "/Users/tao/Downloads/example/Weixin Image_20260318182654_5035_81.jpg",
    ],
    tags: ["生活记录", "光影"],
    minutesFromNow: 180,
  },
  {
    type: "video",
    title: "这段录屏记录了我的工作流",
    content: "分享一下最近的效率工具组合，简单但好用。",
    videoPath: "/Users/tao/Desktop/Screen Recording 2026-03-26 at 10.59.31.mov",
    tags: ["效率", "工具"],
    minutesFromNow: 210,
  },
]

for (const task of TASKS) {
  const scheduleAt = new Date(Date.now() + task.minutesFromNow * 60 * 1000).toISOString()
  console.error(`\n[task] "${task.title}" → schedule at ${scheduleAt}`)

  const managed = await launchBrowser("default")
  try {
    if (task.type === "images") {
      await publishImages(managed.page, {
        title: task.title,
        content: task.content,
        imagePaths: task.imagePaths,
        tags: task.tags,
        visibility: "private",
        scheduleAt,
      })
    } else {
      await publishVideo(managed.page, {
        title: task.title,
        content: task.content,
        videoPath: task.videoPath,
        tags: task.tags,
        visibility: "private",
        scheduleAt,
      })
    }
    await managed.saveCookies()
    console.error(`[ok] scheduled: ${task.title}`)
  } catch (err) {
    console.error(`[fail] ${task.title}:`, err)
  } finally {
    await managed.close()
  }
}

console.error("\n[done] all tasks submitted")
