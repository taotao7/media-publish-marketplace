import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL, SCHEDULE_SUBMIT_BUTTON_TEXTS, SCHEDULE_SUCCESS_TEXTS, PUBLISH_ERROR_TEXTS, PUBLISH_PENDING_TEXTS } from "../src/selectors.js"

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
    if (fileInput) {
      await (fileInput as any).uploadFile("/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov")
    }
    console.log("[1] Waiting for editor...")
    await delay(10_000)

    // Fill title
    const titleInput = await page.$("input[placeholder*='标题']")
    if (titleInput) {
      await titleInput.click({ clickCount: 3 })
      await page.keyboard.type("日常开发记录｜一个小功能的诞生过程", { delay: 20 })
    }
    await delay(500)

    // Enable schedule
    console.log("[2] Enable schedule")
    // Scroll down to make sure the schedule section is visible
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await delay(1_000)
    const sw = await page.waitForSelector(".time-switch-wrp .switch-container", { timeout: 15_000 })
    if (!sw) throw new Error("Switch not found")
    await page.click(".time-switch-wrp .switch-container")
    await delay(800)
    await page.waitForSelector(".time-picker .date-picker-date", { timeout: 5_000 })

    // Pick time 20:00
    console.log("[3] Pick time 20:00")
    await page.click(".date-picker-timer")
    await delay(500)

    // Hour
    await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      const items = Array.from(panels[0]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]
      for (const item of items) {
        if (!item.classList.contains("time-select-disabled") && item.innerText.trim() === "20") {
          item.click(); break
        }
      }
    })
    await delay(400)

    // Minute
    await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      const items = Array.from(panels[1]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]
      for (const item of items) {
        if (!item.classList.contains("time-select-disabled") && item.innerText.trim() === "00") {
          item.click(); break
        }
      }
    })
    await delay(500)

    // Close time picker
    await page.evaluate(() => {
      (document.querySelector(".section-title-content-main") as HTMLElement)?.click()
    })
    await delay(500)

    // Verify
    const [dateShown, timeShown] = await page.evaluate(() => {
      const d = (document.querySelector(".date-picker-date .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      const t = (document.querySelector(".date-picker-timer .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      return [d, t]
    })
    console.log(`  Schedule set: ${dateShown} ${timeShown}`)

    // Now try to click submit
    console.log("[4] Click submit button")
    const submitTexts = [...SCHEDULE_SUBMIT_BUTTON_TEXTS]
    console.log("  Looking for:", submitTexts)

    const bodyTextBefore = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(-500))
    console.log("  Page text (tail):", bodyTextBefore.slice(0, 300))

    // Screenshot before submit
    await page.screenshot({ path: "/tmp/bili-before-submit.png", fullPage: true })

    const clicked = await page.evaluate((texts) => {
      const nodes = Array.from(document.querySelectorAll("button, div, span, a, li, label")) as HTMLElement[]
      const matches = nodes.filter(node => {
        const text = node.innerText?.replace(/\s+/g, " ").trim() ?? ""
        return text && text.length < 40 && node.offsetWidth > 0 && node.offsetHeight > 0 &&
          texts.some(t => text.includes(t))
      }).map(n => ({ tag: n.tagName, text: n.innerText?.trim().slice(0, 40), class: n.className?.slice(0, 60) }))
      if (matches.length > 0) {
        // Click the shortest match
        const best = matches.sort((a, b) => a.text.length - b.text.length)[0]
        const target = nodes.find(n => n.innerText?.replace(/\s+/g, " ").trim()?.slice(0, 40) === best?.text)
        target?.click()
      }
      return matches
    }, submitTexts)
    console.log("  Submit matches:", JSON.stringify(clicked))

    await delay(3_000)

    // Screenshot after submit
    await page.screenshot({ path: "/tmp/bili-after-submit.png", fullPage: true })

    const bodyTextAfter = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))

    // Check for success/error
    for (const t of SCHEDULE_SUCCESS_TEXTS) {
      if (bodyTextAfter.includes(t)) {
        console.log("SUCCESS:", t)
        return
      }
    }
    for (const t of PUBLISH_ERROR_TEXTS) {
      if (bodyTextAfter.includes(t)) {
        console.log("ERROR:", t)
        return
      }
    }

    console.log("  URL:", page.url())
    console.log("  Body tail:", bodyTextAfter.slice(-400))

    // Wait some more
    for (let i = 0; i < 60; i++) {
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
      for (const t of [...SCHEDULE_SUCCESS_TEXTS, "投稿成功", "提交成功"]) {
        if (text.includes(t)) {
          console.log(`\nSUCCESS after ${i}s:`, t)
          await page.screenshot({ path: "/tmp/bili-success.png" })
          return
        }
      }
      const url = page.url()
      if (!url.includes("/platform/upload/video/frame")) {
        console.log(`\nURL changed after ${i}s:`, url)
        await page.screenshot({ path: "/tmp/bili-success.png" })
        return
      }
      await delay(1_000)
    }

    console.log("TIMEOUT waiting for result")
    await page.screenshot({ path: "/tmp/bili-timeout.png", fullPage: true })

  } catch (err) {
    console.error("Error:", err)
    await page.screenshot({ path: "/tmp/bili-error.png" }).catch(() => {})
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
