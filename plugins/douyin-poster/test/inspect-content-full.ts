/**
 * Dump all posts in content management and check tag input.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR, IMAGE_UPLOADED_INDICATOR_SELECTOR } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

// Check content management — dump all posts
await page.goto("https://creator.douyin.com/creator-micro/content/manage", {
  waitUntil: "domcontentloaded",
  timeout: 30_000,
})
await new Promise((r) => setTimeout(r, 3_000))

const allPosts = await page.evaluate(() => {
  // Find all work items
  const items = Array.from(document.querySelectorAll("[class*='card'], [class*='item-wrap'], [class*='work-item'], [class*='content-item']"))
    .filter(el => el.getBoundingClientRect().height > 50)
  return items.map(el => ({
    className: el.className.slice(0, 50),
    text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 200),
  }))
})
console.error("[all posts]", JSON.stringify(allPosts, null, 2))

const bodyFull = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
console.error("[full body]", bodyFull.slice(0, 2000))

// Now check "添加标签" click behavior
await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 4_000))

const tab = await page.$(IMAGE_TAB_SELECTOR)
if (tab) { await tab.click(); await new Promise((r) => setTimeout(r, 2_000)) }

const fileInput = await page.$("input[type='file'][accept*='image']")
if (fileInput) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
    (fileInput as any).uploadFile("/Users/tao/Downloads/example/ScreenShot_2026-03-18_132442_748.png"),
  ])
  const d = Date.now() + 60_000
  while (Date.now() < d) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
    if (n >= 1) { console.error("[ok] image uploaded"); break }
    await new Promise((r) => setTimeout(r, 1_000))
  }

  // Click "添加标签" section
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*"))
    for (const el of els) {
      if (el.textContent?.trim() === "添加标签" && el.children.length <= 1) {
        ;(el as HTMLElement).click()
        return
      }
    }
  })
  await new Promise((r) => setTimeout(r, 1_500))

  // What appeared?
  const tagArea = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => ({
        placeholder: el.placeholder,
        className: el.className.slice(0, 60),
        value: el.value,
      }))
    const tagPopup = Array.from(document.querySelectorAll("[class*='tag'], [class*='label']"))
      .filter(el => el.getBoundingClientRect().height > 30)
      .slice(0, 5)
      .map(el => ({
        className: el.className.slice(0, 60),
        text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
      }))
    return { inputs, tagPopup }
  })
  console.error("[after clicking 添加标签 - inputs]", JSON.stringify(tagArea.inputs, null, 2))
  console.error("[after clicking 添加标签 - tag areas]", JSON.stringify(tagArea.tagPopup, null, 2))

  const bodyAfter = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600))
  console.error("[body after tag click]", bodyAfter)
}

await managed.close()
