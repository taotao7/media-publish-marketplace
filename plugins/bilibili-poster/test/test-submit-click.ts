import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  try {
    await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await delay(5_000)
    const status = await detectLoginStatus(page)
    if (!status.loggedIn) return

    const fileInput = await page.$("input[type='file']")
    if (fileInput) await (fileInput as any).uploadFile("/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov")
    await delay(10_000)

    // Fill title
    const titleInput = await page.$("input[placeholder*='标题']")
    if (titleInput) { await titleInput.click({ clickCount: 3 }); await page.keyboard.type("日常开发记录", { delay: 20 }) }
    await delay(500)

    // Enable schedule
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await delay(500)
    await page.waitForSelector(".time-switch-wrp .switch-container", { timeout: 10_000 })
    await page.click(".time-switch-wrp .switch-container")
    await delay(800)
    await page.waitForSelector(".time-picker .date-picker-date", { timeout: 5_000 })

    // Pick time 20:00
    await page.click(".date-picker-timer")
    await delay(500)
    await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      for (const item of Array.from(panels[0]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]) {
        if (!item.classList.contains("time-select-disabled") && item.innerText.trim() === "20") { item.click(); break }
      }
    })
    await delay(400)
    await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      for (const item of Array.from(panels[1]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]) {
        if (!item.classList.contains("time-select-disabled") && item.innerText.trim() === "00") { item.click(); break }
      }
    })
    await delay(300)
    await page.evaluate(() => (document.querySelector(".section-title-content-main") as HTMLElement)?.click())
    await delay(500)

    console.log("[OK] Schedule set to 2026-04-07 20:00")

    // Dismiss notification banner if present
    console.log("[5] Dismiss notification banner")
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("[class*='close'], [class*='dismiss']"))
      for (const el of all) {
        if (!(el instanceof HTMLElement)) continue
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.bottom > 500) {
          try { el.click() } catch {}
        }
      }
    })
    await delay(500)

    // Now try clicking submit with Puppeteer's page.click (real input simulation)
    console.log("[6] Submit via page.click")

    // First find the SPAN.submit-add element
    const submitBtn = await page.$("span.submit-add")
    if (submitBtn) {
      console.log("  Found span.submit-add, clicking...")
      await submitBtn.scrollIntoViewIfNeeded()
      await submitBtn.click()
    } else {
      console.log("  span.submit-add not found, trying by text...")
      // Fallback: click by evaluating
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("span, button")) as HTMLElement[]
        for (const node of nodes) {
          if (node.innerText?.trim() === "立即投稿" && node.offsetWidth > 0) {
            node.scrollIntoView({ block: "center" })
            node.click()
            console.log("Clicked:", node.tagName, node.className)
            break
          }
        }
      })
    }

    console.log("[7] Waiting for result...")
    const startUrl = page.url()

    for (let i = 0; i < 120; i++) {
      const url = page.url()
      if (url !== startUrl && !url.includes("/platform/upload/video/frame")) {
        console.log(`SUCCESS: URL changed to ${url} after ${i}s`)
        await page.screenshot({ path: "/tmp/bili-submit-success.png" })
        return
      }

      const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))

      const successTexts = ["投稿成功", "稿件投递成功", "提交成功", "上传成功", "投稿完成", "预约成功", "预约发布成功", "定时发布成功"]
      for (const t of successTexts) {
        if (bodyText.includes(t)) {
          console.log(`SUCCESS: Found "${t}" after ${i}s`)
          await page.screenshot({ path: "/tmp/bili-submit-success.png" })
          return
        }
      }

      const errorTexts = ["标题不能为空", "请选择分区", "投稿失败", "上传失败"]
      for (const t of errorTexts) {
        if (bodyText.includes(t)) {
          console.log(`ERROR: Found "${t}" after ${i}s`)
          await page.screenshot({ path: "/tmp/bili-submit-error.png" })
          return
        }
      }

      // Check for confirmation dialog
      if (bodyText.includes("确认投稿") || bodyText.includes("确认发布")) {
        console.log(`  Confirmation dialog at ${i}s, clicking confirm...`)
        await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("button, span, div")) as HTMLElement[]
          for (const n of nodes) {
            const t = n.innerText?.trim() ?? ""
            if ((t === "确认投稿" || t === "确认发布" || t === "确认") && n.offsetWidth > 0 && t.length < 10) {
              n.click()
              break
            }
          }
        })
      }

      if (i % 10 === 9) {
        console.log(`  Still waiting... ${i+1}s, url=${url.slice(-40)}`)
        await page.screenshot({ path: `/tmp/bili-waiting-${i+1}.png` })
      }

      await delay(1_000)
    }

    console.log("TIMEOUT")
    await page.screenshot({ path: "/tmp/bili-submit-timeout.png", fullPage: true })

  } catch (err) {
    console.error("Error:", err)
    await page.screenshot({ path: "/tmp/bili-submit-crash.png" }).catch(() => {})
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
