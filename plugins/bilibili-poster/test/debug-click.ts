import { launchBrowser } from "../src/browser.js"
import { detectLoginStatus } from "../src/login.js"
import { CREATOR_UPLOAD_URL } from "../src/selectors.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  const status = await detectLoginStatus(page)
  if (!status.loggedIn) throw new Error("Not logged in")

  await page.goto(CREATOR_UPLOAD_URL, { waitUntil: "domcontentloaded" })
  await delay(5_000)

  // Dump all buttons and their state
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button")).map((btn) => {
      const r = btn.getBoundingClientRect()
      return {
        text: btn.innerText?.trim(),
        disabled: btn.disabled,
        classes: btn.className,
        rect: { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height },
      }
    }),
  )
  console.log("All buttons:", JSON.stringify(buttons, null, 2))

  // Try clicking 立即投稿
  const target = buttons.find((b) => b.text === "立即投稿")
  if (!target) {
    console.error("Button not found!")
    await page.screenshot({ path: "/tmp/debug-click.png", fullPage: true })
    await browser.close()
    return
  }

  console.log("Target button:", target)
  console.log(`Clicking at (${target.rect.x}, ${target.rect.y})`)

  await page.mouse.click(target.rect.x, target.rect.y)
  await delay(3_000)

  await page.screenshot({ path: "/tmp/debug-click-after.png", fullPage: true })
  console.log("Screenshot saved: /tmp/debug-click-after.png")
  console.log("URL after click:", page.url())
  console.log("Body tail:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(-300)))

  await browser.close()
}

main().catch(console.error)
