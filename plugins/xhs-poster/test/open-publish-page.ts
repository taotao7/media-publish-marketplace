import { launchBrowser } from "../src/browser.js"

const PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official&target=image"

const managed = await launchBrowser("default")
console.log("Browser opened, navigating to publish page...")
await managed.page.goto(PUBLISH_URL, { waitUntil: "load" })
console.log("Page loaded, waiting 15 seconds...")
await new Promise((r) => setTimeout(r, 15000))
await managed.close()
console.log("Browser closed.")
