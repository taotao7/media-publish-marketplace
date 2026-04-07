import { launchBrowser } from "../src/browser.js"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await launchBrowser("default")
  const { page } = browser

  // Go to the upload page (should already have a draft from previous runs)
  await page.goto("https://member.bilibili.com/platform/upload/video/frame", { waitUntil: "domcontentloaded", timeout: 15_000 })
  await delay(5_000)

  // Dump submit button info
  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
    const submit = btns.find((b) => b.innerText?.trim() === "立即投稿")
    if (!submit) return { found: false, allBtns: btns.map((b) => b.innerText?.trim()).filter(Boolean) }
    const r = submit.getBoundingClientRect()
    const style = getComputedStyle(submit)
    return {
      found: true,
      disabled: submit.disabled,
      classes: submit.className,
      pointer: style.pointerEvents,
      opacity: style.opacity,
      rect: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) },
      parentTag: submit.parentElement?.tagName,
      parentClass: submit.parentElement?.className,
    }
  })
  console.log("Button info:", JSON.stringify(info, null, 2))

  if (info.found && info.rect) {
    // Try 3 different click methods
    console.log("\n--- Method 1: page.mouse.click ---")
    await page.mouse.click(info.rect.x, info.rect.y)
    await delay(2_000)
    console.log("URL:", page.url())
    await page.screenshot({ path: "/tmp/click1.png", fullPage: true })

    console.log("\n--- Method 2: page.evaluate dispatchEvent ---")
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText?.trim() === "立即投稿")!
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await delay(2_000)
    console.log("URL:", page.url())
    await page.screenshot({ path: "/tmp/click2.png", fullPage: true })

    console.log("\n--- Method 3: page.evaluate .click() ---")
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText?.trim() === "立即投稿")!
      btn.click()
    })
    await delay(2_000)
    console.log("URL:", page.url())
    await page.screenshot({ path: "/tmp/click3.png", fullPage: true })

    console.log("\nScreenshots: /tmp/click1.png, /tmp/click2.png, /tmp/click3.png")
  }

  await browser.close()
}

main().catch(console.error)
