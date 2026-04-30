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
  DATE_PICKER_CONTENT,
  PUBLISH_BTN,
  POPOVER,
  FILE_RELATION_CONTAINER,
  FILE_RELATION_INPUT,
} from "./selectors.js"

const PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official&target=image"
const IMAGE_UPLOAD_TIMEOUT_MS = 60_000
const MAX_TAGS = 10
const XHS_TIMEZONE = process.env.XHS_TIMEZONE || "Asia/Shanghai"
const SCHEDULE_POPOVER = ".post-time-date-picker-popover-class"
const DATE_PICKER_HEADER = ".d-datepicker-header"
const DATE_PICKER_HEADER_ICON = ".d-icon.d-clickable"
const DATE_PICKER_CELL = ".d-datepicker-dates .d-datepicker-cell.d-clickable"
const TIME_PICKER_BAR = ".d-timepicker-timebar"
const TIME_PICKER_OPTION = ".d-timepicker-time"

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
  const schedule = formatScheduleInXhsTimezone(isoDate)
  const toggle = await page.waitForSelector(SCHEDULE_SWITCH, { timeout: 5000 })
  if (!toggle) throw new Error("Schedule switch not found")
  if (!(await isScheduleEnabled(page))) {
    await toggle.click()
    await delay(1000)
  }

  const pickerContent = await page.waitForSelector(DATE_PICKER_CONTENT, {
    timeout: 5000,
  })
  if (!pickerContent) throw new Error("Date picker content not found")
  await pickerContent.click()
  await page.waitForSelector(SCHEDULE_POPOVER, { visible: true, timeout: 5000 })

  const result = await page.evaluate(
    async ({
      popoverSelector,
      headerSelector,
      headerIconSelector,
      dateCellSelector,
      timeBarSelector,
      timeOptionSelector,
      year,
      month,
      day,
      hour,
      minute,
    }) => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const clickElement = (el: Element) => {
        for (const type of ["mousedown", "mouseup", "click"]) {
          el.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
          )
        }
      }
      const popover = document.querySelector(popoverSelector)
      if (!popover) return { ok: false, reason: "Schedule date picker not found" }

      const currentMonth = () => {
        const text =
          popover
            .querySelector(".d-datepicker-header-main")
            ?.textContent?.replace(/\s+/g, "") ?? ""
        const match = text.match(/(\d{4})年(\d{1,2})月/)
        if (!match) return null
        return { year: Number(match[1]), month: Number(match[2]) }
      }

      for (let i = 0; i < 18; i++) {
        const current = currentMonth()
        if (!current) return { ok: false, reason: "Cannot read date picker month" }
        if (current.year === year && current.month === month) break

        const delta = (year - current.year) * 12 + (month - current.month)
        const header = popover.querySelector(headerSelector)
        const icons = Array.from(header?.querySelectorAll(headerIconSelector) ?? [])
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        const monthButton = delta > 0 ? icons[2] : icons[1]
        if (!monthButton) {
          return { ok: false, reason: "Date picker month navigation not found" }
        }
        clickElement(monthButton)
        await wait(250)
      }

      const current = currentMonth()
      if (!current || current.year !== year || current.month !== month) {
        return { ok: false, reason: `Cannot navigate to ${year}-${month}` }
      }

      const dateCells = Array.from(popover.querySelectorAll(dateCellSelector))
        .filter((el) => !el.className.toString().includes("disabled"))
      const dateCell = dateCells.find(
        (el) => (el.textContent ?? "").trim() === String(day),
      )
      if (!dateCell) {
        return { ok: false, reason: `Date cell not found: ${day}` }
      }
      clickElement(dateCell)
      await wait(250)

      const bars = Array.from(popover.querySelectorAll(timeBarSelector))
      if (bars.length < 2) {
        return { ok: false, reason: "Time picker columns not found" }
      }

      const clickTime = async (
        bar: Element,
        value: number,
        suffix: "时" | "分",
      ): Promise<string | null> => {
        const expected = String(value).padStart(2, "0")
        const options = Array.from(bar.querySelectorAll(timeOptionSelector))
        const option = options.find((el) => {
          const text = (el.textContent ?? "").replace(suffix, "").trim()
          return text === expected
        })
        if (!option) return `${expected}${suffix} not found`
        option.scrollIntoView({ block: "center" })
        await wait(100)
        clickElement(option)
        await wait(250)
        return null
      }

      const hourError = await clickTime(bars[0], hour, "时")
      if (hourError) return { ok: false, reason: hourError }
      const minuteError = await clickTime(bars[1], minute, "分")
      if (minuteError) return { ok: false, reason: minuteError }

      return { ok: true }
    },
    {
      popoverSelector: SCHEDULE_POPOVER,
      headerSelector: DATE_PICKER_HEADER,
      headerIconSelector: DATE_PICKER_HEADER_ICON,
      dateCellSelector: DATE_PICKER_CELL,
      timeBarSelector: TIME_PICKER_BAR,
      timeOptionSelector: TIME_PICKER_OPTION,
      year: schedule.year,
      month: schedule.month,
      day: schedule.day,
      hour: schedule.hour,
      minute: schedule.minute,
    },
  )

  if (!result.ok) {
    throw new Error(`Failed to set schedule: ${result.reason}`)
  }

  await page
    .waitForFunction(
      (inputSelector, switchSelector, publishButtonSelector, expected) => {
        const input = document.querySelector(inputSelector) as HTMLInputElement | null
        const checked = Boolean(
          (
            document.querySelector(`${switchSelector} input[type="checkbox"]`) as
              | HTMLInputElement
              | null
          )?.checked,
        )
        const publishButton = document.querySelector(publishButtonSelector)
        return (
          input?.value === expected &&
          checked &&
          publishButton?.textContent?.includes("定时发布")
        )
      },
      { timeout: 5000 },
      DATE_PICKER_INPUT,
      SCHEDULE_SWITCH,
      PUBLISH_BTN,
      schedule.formatted,
    )
    .catch(async () => {
      const state = await page.evaluate(
        (inputSelector, switchSelector, publishButtonSelector) => {
          const input = document.querySelector(inputSelector) as HTMLInputElement | null
          const checkbox = document.querySelector(
            `${switchSelector} input[type="checkbox"]`,
          ) as HTMLInputElement | null
          const publishButton = document.querySelector(publishButtonSelector)
          return {
            inputValue: input?.value ?? null,
            checked: checkbox?.checked ?? false,
            publishText: publishButton?.textContent?.trim() ?? null,
          }
        },
        DATE_PICKER_INPUT,
        SCHEDULE_SWITCH,
        PUBLISH_BTN,
      )
      throw new Error(
        `Schedule did not stick. Expected ${schedule.formatted}, got ${JSON.stringify(state)}`,
      )
    })

  await delay(500)
}

async function isScheduleEnabled(page: Page): Promise<boolean> {
  return page
    .$eval(SCHEDULE_SWITCH, (el) =>
      Boolean((el.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked),
    )
    .catch(() => false)
}

interface XhsScheduleParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly formatted: string
}

function formatScheduleInXhsTimezone(isoDate: string): XhsScheduleParts {
  const date = new Date(isoDate)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: XHS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const value = (type: string): string => {
    const found = parts.find((part) => part.type === type)?.value
    if (!found) throw new Error(`Cannot format schedule ${type}`)
    return found
  }

  const year = Number(value("year"))
  const month = Number(value("month"))
  const day = Number(value("day"))
  const hour = Number(value("hour"))
  const minute = Number(value("minute"))

  return {
    year,
    month,
    day,
    hour,
    minute,
    formatted: `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`,
  }
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
