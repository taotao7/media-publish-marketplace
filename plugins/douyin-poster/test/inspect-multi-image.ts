/**
 * Diagnostic: use page.waitForFileChooser() after clicking 继续添加.
 */
import { launchBrowser } from "../src/browser.js"
import { CREATOR_UPLOAD_URL, IMAGE_TAB_SELECTOR, IMAGE_UPLOADED_INDICATOR_SELECTOR } from "../src/selectors.js"

const managed = await launchBrowser("default")
const page = managed.page

await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
await new Promise((r) => setTimeout(r, 4_000))

const tab = await page.$(IMAGE_TAB_SELECTOR)
if (tab) { await tab.click(); await new Promise((r) => setTimeout(r, 2_000)) }

const fileInput = await page.$("input[type='file'][accept*='image']")
if (!fileInput) { console.error("[error] no file input"); await managed.close(); process.exit(1) }

console.error("[uploading first image...]")
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
  (fileInput as any).uploadFile("/Users/tao/Downloads/example/ScreenShot_2026-03-18_132442_748.png"),
])

// Wait for thumbnail
const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  const count = await page.evaluate((sel) => {
    try { return document.querySelectorAll(sel).length } catch { return 0 }
  }, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
  if (count >= 1) { console.error(`[ok] 1st thumbnail (count=${count})`); break }
  await new Promise((r) => setTimeout(r, 1_000))
}

// Use waitForFileChooser to intercept the file dialog triggered by 继续添加
const btn = await page.$("button[class*='continue-add']")
console.error("[continue-add button found]", !!btn, "tag:", await btn?.evaluate(el => el.tagName))

try {
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5_000 }),
    btn!.click(),
  ])
  console.error("[FileChooser triggered! isMultiple:", chooser.isMultiple(), "]")
  await chooser.accept(["/Users/tao/Downloads/example/ScreenShot_2026-03-18_135002_880.png"])
  console.error("[file accepted via chooser]")

  // Wait for 2nd thumbnail
  const deadline2 = Date.now() + 60_000
  while (Date.now() < deadline2) {
    const count = await page.evaluate((sel) => {
      try { return document.querySelectorAll(sel).length } catch { return 0 }
    }, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
    if (count >= 2) { console.error(`[ok] 2nd thumbnail (count=${count})`); break }
    await new Promise((r) => setTimeout(r, 1_000))
  }
} catch (err) {
  console.error("[waitForFileChooser failed]", err)
  // Fallback: maybe there IS a DOM input that appears momentarily
  await btn!.click()
  await new Promise((r) => setTimeout(r, 500))
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input[type='file']")).map(el => ({
      accept: (el as HTMLInputElement).accept,
      className: el.className,
    }))
  )
  console.error("[DOM file inputs after click]", JSON.stringify(inputs))
}

const finalCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
console.error("[final thumbnail count]", finalCount)

await managed.close()
