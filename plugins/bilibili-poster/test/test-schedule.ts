import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  try {
    console.log("[1] Navigate to upload page")
    await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await delay(5_000)

    const status = await detectLoginStatus(page)
    console.log("Login:", status.loggedIn)
    if (!status.loggedIn) return

    console.log("[2] Upload file")
    const fileInput = await page.$("input[type='file']")
    if (fileInput) {
      await (fileInput as any).uploadFile("/Users/tao/Desktop/Screen Recording 2026-04-07 at 11.09.08.mov")
    }
    await delay(8_000)

    console.log("[3] Click schedule switch")
    const switchSel = ".time-switch-wrp .switch-container"
    const active = await page.$eval(switchSel, (el) => el.classList.contains("switch-container-active")).catch(() => false)
    console.log("  Already active:", active)
    if (!active) {
      await page.click(switchSel)
      await delay(800)
    }

    // Verify switch is now active
    const nowActive = await page.$eval(switchSel, (el) => el.classList.contains("switch-container-active")).catch(() => false)
    console.log("  Switch active after click:", nowActive)

    // Wait for time picker
    const hasPicker = await page.waitForSelector(".time-picker .date-picker-date", { timeout: 5_000 }).catch(() => null)
    console.log("  Date picker visible:", !!hasPicker)

    // Read current values
    const [dateShown, timeShown] = await page.evaluate(() => {
      const d = (document.querySelector(".date-picker-date .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      const t = (document.querySelector(".date-picker-timer .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      return [d, t]
    })
    console.log(`  Current: date=${dateShown}, time=${timeShown}`)

    console.log("[4] Pick time 20:00")
    // Click time picker to open
    await page.click(".date-picker-timer")
    await delay(500)

    // Select hour 20
    const hourResult = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      if (panels.length < 2) return { ok: false, reason: "panels<2" }
      const items = Array.from(panels[0]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]
      for (const item of items) {
        if (item.classList.contains("time-select-disabled")) continue
        if (item.innerText.trim() === "20") {
          item.click()
          return { ok: true, clicked: "20" }
        }
      }
      return { ok: false, reason: "hour 20 not found or disabled" }
    })
    console.log("  Hour:", JSON.stringify(hourResult))

    await delay(300)

    // Select minute 00
    const minuteResult = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp")) as HTMLElement[]
      if (panels.length < 2) return { ok: false, reason: "panels<2" }
      const items = Array.from(panels[1]!.querySelectorAll("span.time-picker-panel-select-item")) as HTMLElement[]
      for (const item of items) {
        if (item.classList.contains("time-select-disabled")) continue
        if (item.innerText.trim() === "00") {
          item.click()
          return { ok: true, clicked: "00" }
        }
      }
      return { ok: false, reason: "minute 00 not found or disabled" }
    })
    console.log("  Minute:", JSON.stringify(minuteResult))

    // Close time picker
    await delay(300)
    await page.evaluate(() => {
      (document.querySelector(".section-title-content-main") as HTMLElement | null)?.click()
    })
    await delay(500)

    // Read final values
    const [finalDate, finalTime] = await page.evaluate(() => {
      const d = (document.querySelector(".date-picker-date .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      const t = (document.querySelector(".date-picker-timer .date-show") as HTMLElement)?.innerText?.trim() ?? ""
      return [d, t]
    })
    console.log(`\n[5] Final: date=${finalDate}, time=${finalTime}`)

    if (finalDate === "2026-04-07" && finalTime === "20:00") {
      console.log("SUCCESS: Schedule set correctly!")
    } else {
      console.log(`FAIL: Expected 2026-04-07 20:00, got ${finalDate} ${finalTime}`)
    }

  } catch (err) {
    console.error("Error:", err)
  } finally {
    await delay(500)
    await browser.close()
  }
}

main()
