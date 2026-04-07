import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  try {
    console.log("[1] goto upload page")
    await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await delay(5_000)

    const status = await detectLoginStatus(page)
    if (!status.loggedIn) {
      console.error("Not logged in!")
      return
    }

    console.log("[2] upload file")
    const fileInput = await page.$("input[type='file']")
    if (fileInput) {
      await (fileInput as any).uploadFile("/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov")
    }
    await delay(8_000)

    console.log("[3] dump time-container HTML")
    const containerHtml = await page.evaluate(() => {
      const c = document.querySelector(".time-container")
      return c ? c.outerHTML : "NOT FOUND"
    })
    console.log("BEFORE click:")
    console.log(containerHtml.slice(0, 4000))

    console.log("\n[4] click time-switch-wrp (the actual switch)")
    const clickRes = await page.evaluate(() => {
      // Find clickable inside time-switch-wrp - usually a switch/checkbox
      const wrp = document.querySelector(".time-switch-wrp")
      if (!wrp) return { found: false, reason: "no .time-switch-wrp" }

      // Look for the actual switch element (could be a div with class containing 'switch' or 'btn')
      const switches = wrp.querySelectorAll(".bcc-switch, [class*='switch'], [class*='btn'], button, input[type='checkbox']")
      const list: string[] = []
      switches.forEach((el) => {
        list.push(`${el.tagName}.${(el as HTMLElement).className?.slice(0,80)}`)
      })

      // Click the first non-text element
      for (const el of Array.from(switches)) {
        if (el.tagName !== "SPAN" || !(el as HTMLElement).className.includes("text")) {
          (el as HTMLElement).click()
          return { found: true, clicked: `${el.tagName}.${(el as HTMLElement).className?.slice(0,80)}`, candidates: list }
        }
      }
      return { found: false, reason: "no switch found", candidates: list }
    })
    console.log("Click result:", JSON.stringify(clickRes, null, 2))

    await delay(2_000)

    console.log("\n[5] dump time-container HTML AFTER click")
    const afterHtml = await page.evaluate(() => {
      const c = document.querySelector(".time-container")
      return c ? c.outerHTML : "NOT FOUND"
    })
    console.log(afterHtml.slice(0, 6000))

    console.log("\n[6] dump dialog HTML if visible")
    const dialogHtml = await page.evaluate(() => {
      const dialogs = document.querySelectorAll(".time-release-dialog, [class*='dialog'], [class*='Dialog'], [class*='modal'], [class*='Modal']")
      const visible: any[] = []
      dialogs.forEach((el) => {
        const style = window.getComputedStyle(el as HTMLElement)
        const rect = (el as HTMLElement).getBoundingClientRect()
        if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0) {
          visible.push({
            tag: el.tagName,
            class: (el as HTMLElement).className?.slice(0, 100),
            html: el.outerHTML.slice(0, 3000),
          })
        }
      })
      return visible
    })
    console.log(JSON.stringify(dialogHtml, null, 2))

    console.log("\n[7] dump all visible inputs after click")
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }).map(el => ({
        type: el.type, placeholder: el.placeholder, value: el.value,
        class: el.className?.slice(0,100), parent: el.parentElement?.className?.slice(0,80),
      }))
    })
    console.log(JSON.stringify(inputs, null, 2))

    await page.screenshot({ path: "/tmp/bilibili-dialog.png", fullPage: true })
    console.log("\nScreenshot: /tmp/bilibili-dialog.png")

  } catch (err) {
    console.error("Error:", err)
  } finally {
    await delay(1_000)
    await browser.close()
  }
}

main()
