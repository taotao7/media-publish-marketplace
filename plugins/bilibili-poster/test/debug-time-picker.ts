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
      const sw = document.querySelector(".time-switch-wrp .switch-container") as HTMLElement
      sw?.click()
    })
    await delay(2_000)

    // Dump full time-picker HTML
    const timePicker = await page.evaluate(() => {
      const tp = document.querySelector(".time-picker")
      return tp ? tp.outerHTML : "NOT FOUND"
    })
    writeFileSync("/tmp/bili-time-picker.html", timePicker)
    console.log("Saved time-picker HTML to /tmp/bili-time-picker.html, length:", timePicker.length)

    // Dump structure tree
    const tree = await page.evaluate(() => {
      const tp = document.querySelector(".time-picker")
      if (!tp) return "NOT FOUND"

      function walk(el: Element, depth: number, max: number): string {
        if (depth > max) return ""
        const tag = el.tagName.toLowerCase()
        const cls = (el as HTMLElement).className?.toString().slice(0, 80) || ""
        const text = (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 50) || ""
        const id = el.id ? `#${el.id}` : ""
        const placeholder = (el as HTMLInputElement).placeholder || ""
        const type = (el as HTMLInputElement).type || ""
        const indent = "  ".repeat(depth)
        let line = `${indent}${tag}${id}${cls ? "." + cls.replace(/\s+/g, ".") : ""}`
        if (type) line += ` [type=${type}]`
        if (placeholder) line += ` [placeholder="${placeholder}"]`
        if (text && el.children.length === 0) line += `  >> "${text}"`
        let out = line + "\n"
        for (const child of Array.from(el.children)) {
          out += walk(child, depth + 1, max)
        }
        return out
      }

      return walk(tp, 0, 10)
    })
    writeFileSync("/tmp/bili-time-picker.tree", tree)
    console.log("Saved tree, length:", tree.length)
    console.log("\n=== TREE ===")
    console.log(tree)

  } catch (err) {
    console.error("Error:", err)
  } finally {
    await delay(1_000)
    await browser.close()
  }
}

main()
