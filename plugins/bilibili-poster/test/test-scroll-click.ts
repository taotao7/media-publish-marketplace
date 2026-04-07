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
    if (!(await detectLoginStatus(page)).loggedIn) return

    const fi = await page.$("input[type='file']")
    if (fi) await (fi as any).uploadFile("/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov")
    await delay(10_000)

    // Fill title
    const ti = await page.$("input[placeholder*='标题']")
    if (ti) { await ti.click({ clickCount: 3 }); await page.keyboard.type("测试定时发布", { delay: 20 }) }
    await delay(500)

    // Enable schedule
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await delay(500)
    await page.waitForSelector(".time-switch-wrp .switch-container", { timeout: 10_000 })
    await page.click(".time-switch-wrp .switch-container")
    await delay(800)
    await page.waitForSelector(".time-picker .date-picker-timer", { timeout: 5_000 })
    await page.click(".date-picker-timer")
    await delay(500)
    await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      for (const i of Array.from(ps[0]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[])
        if (!i.classList.contains("time-select-disabled") && i.innerText.trim() === "20") { i.click(); break }
    })
    await delay(400)
    await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      for (const i of Array.from(ps[1]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[])
        if (!i.classList.contains("time-select-disabled") && i.innerText.trim() === "00") { i.click(); break }
    })
    await delay(300)
    await page.evaluate(() => (document.querySelector(".section-title-content-main") as HTMLElement)?.click())
    await delay(500)
    console.log("Schedule set OK")

    // SCROLL the submit button into view and click via page.click selector
    console.log("\n[SUBMIT] Scrolling submit button into view")
    await page.evaluate(() => {
      const btn = document.querySelector("span.submit-add")
      btn?.scrollIntoView({ block: "center", inline: "center" })
    })
    await delay(500)

    // Get new coordinates after scroll
    const rect = await page.evaluate(() => {
      const btn = document.querySelector("span.submit-add") as HTMLElement
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: r.width, h: r.height }
    })
    console.log("Button rect after scroll:", rect)

    if (!rect) { console.log("Button not found!"); return }

    // Click using mouse at the scrolled-into-view coordinates
    console.log(`Clicking at (${rect.x}, ${rect.y})`)
    await page.mouse.click(rect.x, rect.y)
    await delay(3_000)

    // Screenshot immediately after click
    await page.screenshot({ path: "/tmp/bili-after-click.png" })
    const urlAfter = page.url()
    console.log("URL after click:", urlAfter)

    // Check page state
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))

    // Check for confirmation dialog
    if (bodyText.includes("确认投稿") || bodyText.includes("确认") && bodyText.includes("投稿")) {
      console.log("Confirmation dialog! clicking...")
      await page.evaluate(() => {
        for (const n of Array.from(document.querySelectorAll("button, span, div, a")) as HTMLElement[]) {
          const t = n.innerText?.trim() ?? ""
          if ((t === "确认" || t === "确认投稿") && n.offsetWidth > 0 && t.length < 10) { n.click(); break }
        }
      })
      await delay(2_000)
    }

    // Wait for result
    const startUrl = urlAfter
    for (let i = 0; i < 60; i++) {
      const url = page.url()
      if (url !== startUrl && !url.includes("/upload/video/frame")) {
        console.log(`SUCCESS: URL changed to ${url}`)
        await page.screenshot({ path: "/tmp/bili-final-ok.png" })
        return
      }
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
      for (const h of ["投稿成功", "提交成功", "预约成功", "定时发布成功", "稿件投递成功"]) {
        if (text.includes(h)) { console.log(`SUCCESS: ${h}`); return }
      }
      for (const h of ["投稿失败", "标题不能为空", "请选择分区", "上传失败"]) {
        if (text.includes(h)) { console.log(`ERROR: ${h}`); return }
      }
      await delay(1_000)
    }
    console.log("TIMEOUT")
    await page.screenshot({ path: "/tmp/bili-timeout2.png", fullPage: true })

  } catch (err) {
    console.error("Error:", err)
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
