import { existsSync } from "node:fs"
import type { Page, ElementHandle } from "puppeteer"
import {
  UPLOAD_CONTENT_AREA,
  CREATOR_TAB,
  UPLOAD_INPUT_FIRST,
  UPLOAD_INPUT,
  IMG_PREVIEW,
  TITLE_INPUT,
  TITLE_MAX_SUFFIX,
  CONTENT_EDITOR,
  CONTENT_PLACEHOLDER,
  CONTENT_LENGTH_ERROR,
  TOPIC_CONTAINER,
  TOPIC_ITEM,
  SCHEDULE_SWITCH,
  DATE_PICKER_INPUT,
  PUBLISH_BTN,
  POPOVER,
  FILE_RELATION_CONTAINER,
  FILE_RELATION_INPUT,
} from "./selectors.js"

const PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official&target=image"
const IMAGE_UPLOAD_TIMEOUT_MS = 60_000
const MAX_TAGS = 10

export interface PublishParams {
  readonly title: string
  readonly content: string
  readonly images: readonly string[]
  readonly tags?: readonly string[]
  readonly scheduleAt?: string
  readonly attachments?: readonly string[]
}

export async function publishContent(
  page: Page,
  params: PublishParams,
): Promise<void> {
  validateParams(params)

  console.error("[publish] navigating to publish page…")
  await page.goto(PUBLISH_URL, { waitUntil: "load" })
  await delay(3000)

  console.error("[publish] waiting for upload content area…")
  await page.waitForSelector(UPLOAD_CONTENT_AREA, { visible: true, timeout: 15_000 })

  console.error("[publish] clicking upload tab…")
  await clickUploadTab(page)

  console.error("[publish] uploading images…")
  await uploadImages(page, params.images)

  const attachments = params.attachments ?? []
  if (attachments.length > 0) {
    console.error("[publish] uploading attachments…")
    await uploadAttachments(page, attachments)
  }

  console.error("[publish] filling title…")
  await fillTitle(page, params.title)

  console.error("[publish] filling content…")
  await fillContent(page, params.content)

  const tags = params.tags?.slice(0, MAX_TAGS) ?? []
  if (tags.length > 0) {
    console.error("[publish] filling tags…")
    await fillTags(page, tags)
  }

  if (params.scheduleAt) {
    console.error("[publish] setting schedule…")
    await setSchedule(page, params.scheduleAt)
  }

  console.error("[publish] clicking publish button…")
  await clickPublish(page)
  await delay(3000)
  console.error("[publish] done!")
}

// ── validation ───────────────────────────────────────────────────────

function validateParams(params: PublishParams): void {
  if (params.images.length === 0) {
    throw new Error("At least one image is required")
  }

  for (const img of params.images) {
    if (!existsSync(img)) {
      throw new Error(`Image file not found: ${img}`)
    }
  }

  if (params.attachments) {
    for (const file of params.attachments) {
      if (!existsSync(file)) {
        throw new Error(`Attachment file not found: ${file}`)
      }
    }
  }

  if (params.scheduleAt) {
    const scheduled = new Date(params.scheduleAt)
    if (Number.isNaN(scheduled.getTime())) {
      throw new Error("scheduleAt must be a valid ISO 8601 date string")
    }
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    const fourteenDays = 14 * 24 * 60 * 60 * 1000
    if (scheduled.getTime() < now + oneHour) {
      throw new Error("scheduleAt must be at least 1 hour in the future")
    }
    if (scheduled.getTime() > now + fourteenDays) {
      throw new Error("scheduleAt must be within 14 days")
    }
  }
}

// ── tab selection ────────────────────────────────────────────────────

async function clickUploadTab(page: Page): Promise<void> {
  await dismissPopover(page)

  // Try clicking via JS evaluate to avoid "not clickable" issues from overlays
  const clicked = await page.evaluate((tabSel) => {
    // Try the specific selector first
    const tabs = document.querySelectorAll(tabSel)
    for (const tab of tabs) {
      if (tab.textContent?.includes("上传图文")) {
        ;(tab as HTMLElement).click()
        return true
      }
    }
    // Fallback: search all elements containing "上传图文"
    const allEls = document.querySelectorAll("div, span, a, button, li")
    for (const el of allEls) {
      const text = el.textContent?.trim() ?? ""
      if (text === "上传图文") {
        ;(el as HTMLElement).click()
        return true
      }
    }
    return false
  }, CREATOR_TAB)

  if (clicked) {
    console.error("[publish] clicked 上传图文 tab")
    await delay(2000)
  } else {
    console.error("[publish] 上传图文 tab not found — assuming already on image upload")
  }
}

// ── image upload ─────────────────────────────────────────────────────

async function uploadImages(
  page: Page,
  images: readonly string[],
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    // For the first image, try the dedicated upload area first, then fall back to file input
    // For subsequent images, use the generic file input
    let input: ElementHandle<HTMLInputElement> | null = null

    if (i === 0) {
      // Wait for the upload area to appear, then find the file input inside or nearby
      await page.waitForSelector(UPLOAD_INPUT_FIRST, { timeout: 10_000 })
      input = await page.$(`${UPLOAD_INPUT_FIRST} input[type="file"]`) as ElementHandle<HTMLInputElement> | null
      if (!input) {
        input = await page.$('input[type="file"]') as ElementHandle<HTMLInputElement> | null
      }
    } else {
      input = await page.waitForSelector(UPLOAD_INPUT, { timeout: 10_000 }) as ElementHandle<HTMLInputElement> | null
    }

    if (!input) throw new Error(`Upload file input not found (index ${i})`)

    console.error(`[publish] uploading image ${i + 1}/${images.length}: ${images[i]}`)
    await input.uploadFile(images[i])
    await waitForImagePreview(page, i + 1)
  }
}

async function waitForImagePreview(
  page: Page,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + IMAGE_UPLOAD_TIMEOUT_MS
  while (Date.now() < deadline) {
    const count = await page.$$eval(IMG_PREVIEW, (els) => els.length)
    if (count >= expectedCount) return
    await delay(500)
  }
  throw new Error(
    `Image upload timed out waiting for ${expectedCount} preview(s)`,
  )
}

// ── attachment upload ─────────────────────────────────────────────────

async function uploadAttachments(
  page: Page,
  attachments: readonly string[],
): Promise<void> {
  for (let i = 0; i < attachments.length; i++) {
    const container = await page.$(FILE_RELATION_CONTAINER)
    if (!container) {
      throw new Error("Attachment upload area (.file-relation-container) not found")
    }

    let input = await page.$(FILE_RELATION_INPUT) as ElementHandle<HTMLInputElement> | null

    // If no file input exists yet, click the container to reveal it
    if (!input) {
      await container.click()
      await delay(1000)
      input = await page.$(FILE_RELATION_INPUT) as ElementHandle<HTMLInputElement> | null
    }

    if (!input) {
      throw new Error("Attachment file input not found inside .file-relation-container")
    }

    console.error(`[publish] uploading attachment ${i + 1}/${attachments.length}: ${attachments[i]}`)
    await input.uploadFile(attachments[i])
    // Wait for the upload to complete — no reliable DOM indicator,
    // so use a fixed delay after each file.
    await delay(3000)
    console.error(`[publish] attachment ${i + 1} uploaded`)
  }
}

// ── title & content ──────────────────────────────────────────────────

async function fillTitle(page: Page, title: string): Promise<void> {
  const input = await page.waitForSelector(TITLE_INPUT, { timeout: 10_000 })
  if (!input) throw new Error("Title input not found")

  await input.click({ clickCount: 3 })
  await input.type(title, { delay: 30 })
  await delay(500)

  const tooLong = await page.$(TITLE_MAX_SUFFIX)
  if (tooLong) {
    throw new Error("Title exceeds maximum length")
  }
}

async function fillContent(page: Page, content: string): Promise<void> {
  // Wait for the content editor to appear (may take time after image upload)
  let editor: ElementHandle<Element> | null = null
  const deadline = Date.now() + 15_000

  while (!editor && Date.now() < deadline) {
    // Try Quill editor
    editor = await page.$(CONTENT_EDITOR)

    if (!editor) {
      // Try finding via placeholder text — search all <p> elements
      editor = await page.evaluateHandle(() => {
        const ps = document.querySelectorAll("p[data-placeholder]")
        for (const p of ps) {
          const ph = p.getAttribute("data-placeholder") ?? ""
          if (ph.includes("输入正文描述") || ph.includes("正文")) {
            // Walk up to find textbox parent
            let current: Element | null = p
            for (let i = 0; i < 5; i++) {
              current = current?.parentElement ?? null
              if (current?.getAttribute("role") === "textbox") return current
            }
            return p.parentElement
          }
        }
        // Last resort: any contenteditable div
        return document.querySelector('[contenteditable="true"]')
      }).then((h) => {
        const el = h.asElement() as ElementHandle<Element> | null
        if (!el) h.dispose()
        return el
      })
    }

    if (!editor) await delay(500)
  }

  if (!editor) throw new Error("Content editor not found")

  await editor.click()
  await page.keyboard.type(content, { delay: 10 })
  await delay(500)

  const tooLong = await page.$(CONTENT_LENGTH_ERROR)
  if (tooLong) {
    throw new Error("Content exceeds maximum length")
  }
}

// ── tags ─────────────────────────────────────────────────────────────

async function fillTags(
  page: Page,
  tags: readonly string[],
): Promise<void> {
  // Move cursor to end of content
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowDown")
  }
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  await delay(300)

  for (const tag of tags) {
    await page.keyboard.type(`#${tag}`, { delay: 30 })
    await delay(1000)

    try {
      await page.waitForSelector(
        `${TOPIC_CONTAINER} ${TOPIC_ITEM}`,
        { timeout: 5000 },
      )
      const item = await page.$(`${TOPIC_CONTAINER} ${TOPIC_ITEM}`)
      if (item) {
        await item.click()
      }
    } catch {
      // Topic suggestion didn't appear — continue without selecting
    }

    await delay(500)
  }
}

// ── schedule ─────────────────────────────────────────────────────────

async function setSchedule(page: Page, isoDate: string): Promise<void> {
  const toggle = await page.waitForSelector(SCHEDULE_SWITCH, { timeout: 5000 })
  if (!toggle) throw new Error("Schedule switch not found")
  await toggle.click()
  await delay(500)

  const dateInput = await page.waitForSelector(DATE_PICKER_INPUT, {
    timeout: 5000,
  })
  if (!dateInput) throw new Error("Date picker input not found")

  const d = new Date(isoDate)
  const formatted = [
    d.getFullYear(),
    "-",
    String(d.getMonth() + 1).padStart(2, "0"),
    "-",
    String(d.getDate()).padStart(2, "0"),
    " ",
    String(d.getHours()).padStart(2, "0"),
    ":",
    String(d.getMinutes()).padStart(2, "0"),
  ].join("")

  await dateInput.click({ clickCount: 3 })
  await dateInput.type(formatted, { delay: 30 })
  await page.keyboard.press("Enter")
  await delay(500)
}

// ── publish button ───────────────────────────────────────────────────

async function clickPublish(page: Page): Promise<void> {
  await dismissPopover(page)

  // Try the specific selector first
  const btn = await page.$(PUBLISH_BTN)
  if (btn) {
    await btn.evaluate((el) => (el as HTMLElement).click())
    return
  }

  // Fallback: find any button containing "发布" text
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button")
    for (const b of buttons) {
      if (b.textContent?.includes("发布") && !b.disabled) {
        b.click()
        return true
      }
    }
    return false
  })

  if (!clicked) {
    throw new Error("Publish button not found")
  }
}

// ── shared helpers ───────────────────────────────────────────────────

async function dismissPopover(page: Page): Promise<void> {
  const popover = await page.$(POPOVER)
  if (popover) {
    await page.evaluate(
      (sel) => document.querySelector(sel)?.remove(),
      POPOVER,
    )
    await delay(300)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
