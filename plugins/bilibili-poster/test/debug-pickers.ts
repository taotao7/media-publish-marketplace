import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"
import { writeFileSync } from "node:fs"

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
    await delay(8_000)

    // Click switch
    await page.evaluate(() => {
      (document.querySelector(".time-switch-wrp .switch-container") as HTMLElement)?.click()
    })
    await delay(2_000)

    // Click date picker
    console.log("=== CLICK DATE PICKER ===")
    await page.evaluate(() => {
      (document.querySelector(".date-picker-date") as HTMLElement)?.click()
    })
    await delay(1_500)

    // Dump what appeared - look for any new overlay/popup
    const datePickerPopup = await page.evaluate(() => {
      // Check the entire page for new visible overlays
      const allElements = document.querySelectorAll("[class*='calendar'], [class*='Calendar'], [class*='popup'], [class*='Popup'], [class*='dropdown'], [class*='Dropdown'], [class*='panel'], [class*='Panel'], [class*='picker-panel'], [class*='date-list'], [class*='date-panel']")
      const results: any[] = []
      allElements.forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect()
        const style = window.getComputedStyle(el as HTMLElement)
        if (rect.width > 0 && style.display !== "none") {
          results.push({
            tag: el.tagName,
            class: (el as HTMLElement).className?.slice(0, 100),
            html: el.outerHTML.slice(0, 2000),
          })
        }
      })
      return results
    })
    console.log("Date popup elements:", JSON.stringify(datePickerPopup, null, 2))

    // Also dump time-container changes
    const dateContainerAfter = await page.evaluate(() => {
      const tp = document.querySelector(".d-time-date-picker-wrp")
      if (!tp) return "NOT FOUND"

      function walk(el: Element, depth: number, max: number): string {
        if (depth > max) return ""
        const tag = el.tagName.toLowerCase()
        const cls = (el as HTMLElement).className?.toString().slice(0, 80) || ""
        const text = el.children.length === 0 ? (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 50) || "" : ""
        const indent = "  ".repeat(depth)
        let line = `${indent}${tag}${cls ? "." + cls.replace(/\s+/g, ".") : ""}`
        if (text) line += `  >> "${text}"`
        let out = line + "\n"
        for (const child of Array.from(el.children)) {
          out += walk(child, depth + 1, max)
        }
        return out
      }

      return walk(tp, 0, 12)
    })
    console.log("\n=== DATE PICKER AREA TREE ===")
    console.log(dateContainerAfter)

    // Close date picker by clicking elsewhere
    await page.evaluate(() => {
      (document.querySelector(".section-title-content-main") as HTMLElement)?.click()
    })
    await delay(1_000)

    // Click time picker
    console.log("=== CLICK TIME PICKER ===")
    await page.evaluate(() => {
      (document.querySelector(".date-picker-timer") as HTMLElement)?.click()
    })
    await delay(1_500)

    const timeContainerAfter = await page.evaluate(() => {
      const tp = document.querySelector(".d-time-date-picker-wrp")
      if (!tp) return "NOT FOUND"

      function walk(el: Element, depth: number, max: number): string {
        if (depth > max) return ""
        const tag = el.tagName.toLowerCase()
        const cls = (el as HTMLElement).className?.toString().slice(0, 80) || ""
        const text = el.children.length === 0 ? (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 50) || "" : ""
        const indent = "  ".repeat(depth)
        let line = `${indent}${tag}${cls ? "." + cls.replace(/\s+/g, ".") : ""}`
        if (text) line += `  >> "${text}"`
        let out = line + "\n"
        for (const child of Array.from(el.children)) {
          out += walk(child, depth + 1, max)
        }
        return out
      }

      return walk(tp, 0, 12)
    })
    console.log("\n=== TIME PICKER AREA TREE ===")
    console.log(timeContainerAfter)

    // Check for popups
    const timePopup = await page.evaluate(() => {
      const allElements = document.querySelectorAll("[class*='scroll'], [class*='Scroll'], [class*='list'], [class*='List'], [class*='panel'], [class*='Panel'], [class*='hour'], [class*='minute'], [class*='timer-panel'], [class*='time-list'], [class*='time-panel'], [class*='picker-panel']")
      const results: any[] = []
      allElements.forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect()
        const style = window.getComputedStyle(el as HTMLElement)
        if (rect.width > 0 && style.display !== "none" && rect.top > 0) {
          results.push({
            tag: el.tagName,
            class: (el as HTMLElement).className?.slice(0, 120),
            text: (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 200),
            rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
          })
        }
      })
      return results
    })
    console.log("\nTime popup elements:", JSON.stringify(timePopup.filter(i => /time|hour|minute|timer|picker/i.test(i.class)), null, 2))

    await page.screenshot({ path: "/tmp/bili-time-picker-click.png" })
    console.log("\nScreenshot: /tmp/bili-time-picker-click.png")

  } catch (err) {
    console.error("Error:", err)
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
