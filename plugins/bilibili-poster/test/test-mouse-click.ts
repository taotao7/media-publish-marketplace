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

    // Enable schedule + set 20:00
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

    // Analyze the submit button DOM
    console.log("\n=== Submit Button Analysis ===")
    const btnInfo = await page.evaluate(() => {
      const span = document.querySelector("span.submit-add") as HTMLElement
      if (!span) return { found: false }

      // Walk up to find the real clickable element
      let el: HTMLElement | null = span
      const chain: string[] = []
      while (el) {
        const rect = el.getBoundingClientRect()
        chain.push(`${el.tagName}.${el.className?.slice(0,60)} [${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`)
        el = el.parentElement
        if (chain.length > 6) break
      }

      const rect = span.getBoundingClientRect()
      return {
        found: true,
        chain,
        rect: { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), w: Math.round(rect.width), h: Math.round(rect.height) },
        computedPointerEvents: window.getComputedStyle(span).pointerEvents,
        disabled: (span as any).disabled,
      }
    })
    console.log(JSON.stringify(btnInfo, null, 2))

    if (!btnInfo.found) { console.log("Button not found!"); return }

    // Click using mouse coordinates
    console.log(`\nClicking at coordinates (${btnInfo.rect.x}, ${btnInfo.rect.y})`)
    await page.mouse.click(btnInfo.rect.x, btnInfo.rect.y)
    await delay(2_000)

    // Check for confirmation dialog
    const bodyAfter = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
    if (bodyAfter.includes("确认投稿") || bodyAfter.includes("确认发布")) {
      console.log("Confirmation dialog found! Clicking confirm...")
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("button, span, div, a")) as HTMLElement[]
        for (const n of nodes) {
          const t = n.innerText?.trim() ?? ""
          if ((t === "确认" || t === "确认投稿" || t === "确认发布") && n.offsetWidth > 0 && t.length < 10) {
            n.click(); break
          }
        }
      })
      await delay(1_000)
    }

    await page.screenshot({ path: "/tmp/bili-after-mouse-click.png" })
    console.log("\nURL:", page.url())

    // Wait for navigation or success
    const startUrl = page.url()
    for (let i = 0; i < 30; i++) {
      const url = page.url()
      if (url !== startUrl) { console.log(`URL changed: ${url}`); break }
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
      const hits = ["投稿成功", "提交成功", "预约成功", "定时发布成功", "稿件投递成功"]
      for (const h of hits) { if (text.includes(h)) { console.log(`SUCCESS: ${h}`); await page.screenshot({ path: "/tmp/bili-success.png" }); return } }
      if (i === 5) { console.log("Page text (tail):", text.slice(-200)) }
      await delay(1_000)
    }

    await page.screenshot({ path: "/tmp/bili-mouse-click-final.png", fullPage: true })
    console.log("Final URL:", page.url())

  } catch (err) {
    console.error("Error:", err)
    await page.screenshot({ path: "/tmp/bili-err.png" }).catch(() => {})
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
