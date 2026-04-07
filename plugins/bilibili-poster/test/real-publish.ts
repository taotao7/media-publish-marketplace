import { launchBrowser } from "../src/browser.js"
import { publishVideo } from "../src/publish.js"

async function main() {
  const browser = await launchBrowser("default")
  try {
    await publishVideo(browser.page, {
      title: "日常开发记录｜一个小功能的诞生过程",
      description: "记录了一段真实的开发过程，从想法到实现，没有剪辑，原汁原味。",
      videoPath: "/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov",
      tags: ["编程", "开发日常", "vlog"],
      scheduleAt: "2026-04-07T20:00:00",
      submitMode: "schedule",
    })
    await browser.saveCookies()
    console.log("\n✓ Publish completed successfully!")
  } catch (err) {
    console.error("\n✗ Publish failed:", (err as Error).message)
    // Take screenshot for debugging
    const url = browser.page.url()
    console.error("URL:", url)
    const bodyText = await browser.page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(-500)).catch(() => "N/A")
    console.error("Page tail:", bodyText)
    await browser.page.screenshot({ path: "/tmp/bili-publish-fail.png", fullPage: true }).catch(() => {})
    console.error("Screenshot: /tmp/bili-publish-fail.png")
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
