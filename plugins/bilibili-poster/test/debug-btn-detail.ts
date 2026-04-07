import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  const status = await detectLoginStatus(page)
  if (!status.loggedIn) throw new Error("Not logged in")

  // Navigate to upload page where previous draft should still be loaded
  await page.goto("https://member.bilibili.com/platform/upload/video/frame", { waitUntil: "domcontentloaded", timeout: 15_000 })
  await delay(8_000)

  // Check what class the submit button has
  const btnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
    return btns.map((b) => ({
      text: b.innerText?.trim(),
      class: b.className,
      id: b.id,
      disabled: b.disabled,
      type: b.type,
      tag: b.outerHTML.slice(0, 200),
    }))
  })
  console.log("All buttons:", JSON.stringify(btnInfo, null, 2))

  // Find the submit button specifically
  const submitBtn = btnInfo.find((b) => b.text === "立即投稿")
  if (!submitBtn) {
    console.error("No 立即投稿 button found!")
    await page.screenshot({ path: "/tmp/debug-no-btn.png", fullPage: true })
    await browser.close()
    return
  }
  console.log("\nSubmit button HTML:", submitBtn.tag)

  // Listen for all click-related events
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText?.trim() === "立即投稿")!
    for (const evt of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
      btn.addEventListener(evt, (e) => {
        console.log(`[EVENT] ${evt} isTrusted=${e.isTrusted} target=${(e.target as HTMLElement).tagName}`)
      })
    }
  })

  // Method: page.click with the button's class selector
  const selector = submitBtn.class ? `button.${submitBtn.class.split(/\s+/).join(".")}` : null
  console.log("\nTrying page.click with selector:", selector)
  if (selector) {
    try {
      await page.click(selector)
      console.log("page.click succeeded")
    } catch (e) {
      console.log("page.click failed:", (e as Error).message)
    }
  }

  await delay(3_000)
  console.log("URL after click:", page.url())
  await page.screenshot({ path: "/tmp/debug-click-result.png", fullPage: true })

  // Collect console logs
  const logs = await page.evaluate(() => (window as any).__debugLogs ?? [])
  console.log("Console logs:", logs)

  await browser.close()
}

main().catch(console.error)
