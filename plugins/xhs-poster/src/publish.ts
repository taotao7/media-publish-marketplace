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
const SCHEDULE_ROW = ".post-time-wrapper"
const DATE_PICKER_HEADER = ".d-datepicker-header"
const DATE_PICKER_HEADER_ICON = ".d-icon.d-clickable"
const DATE_PICKER_CELL = ".d-datepicker-dates .d-datepicker-cell.d-clickable"
const TIME_PICKER_BAR = ".d-timepicker-timebar"
const TIME_PICKER_OPTION = ".d-timepicker-time"
const PUBLISH_OUTCOME_TIMEOUT_MS = 45_000

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
  await ensureScheduleEnabled(page)
  await clickPoint(page, await getDatePickerPoint(page))
  await waitForVisibleSelector(page, SCHEDULE_POPOVER, 5000)

  for (let i = 0; i < 18; i++) {
    const current = await getVisiblePickerMonth(page)
    if (current.year === schedule.year && current.month === schedule.month) break
    const delta = (schedule.year - current.year) * 12 + (schedule.month - current.month)
    await clickPoint(page, await getPickerMonthNavPoint(page, delta > 0 ? "next" : "prev"))
    await delay(250)
  }

  const current = await getVisiblePickerMonth(page)
  if (current.year !== schedule.year || current.month !== schedule.month) {
    throw new Error(`Cannot navigate to ${schedule.year}-${schedule.month}`)
  }

  const currentInputValue = await getScheduleInputValue(page)
  if (!currentInputValue?.startsWith(schedule.formatted.slice(0, 10))) {
    await clickPoint(page, await getDateCellPoint(page, schedule.day))
    await delay(250)
  }
  await clickPoint(page, await getTimeOptionPoint(page, 0, schedule.hour, "时"))
  await delay(250)
  await clickPoint(page, await getTimeOptionPoint(page, 1, schedule.minute, "分"))
  await assertScheduleStuck(page, schedule.formatted)
  await delay(500)
}

async function isScheduleEnabled(page: Page): Promise<boolean> {
  const state = await getScheduleState(page)
  return state.checked
}

interface PagePoint {
  readonly x: number
  readonly y: number
}

interface PickerMonth {
  readonly year: number
  readonly month: number
}

interface ScheduleDomState {
  readonly checked: boolean
  readonly inputValue: string | null
  readonly hasVisibleDateInput: boolean
  readonly publishText: string | null
}

async function ensureScheduleEnabled(page: Page): Promise<void> {
  if (await isScheduleEnabled(page)) return

  await clickScheduleCheckbox(page)
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const state = await getScheduleState(page)
    if (state.checked && state.hasVisibleDateInput) return
    await delay(250)
  }

  throw new Error(
    `Schedule switch did not turn on: ${JSON.stringify(await getScheduleState(page))}`,
  )
}

async function clickScheduleCheckbox(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const wrapper = document.querySelector(".post-time-wrapper")
    if (!wrapper) return false
    wrapper.scrollIntoView({ block: "center" })
    const input = wrapper.querySelector('input[type="checkbox"]') as
      | HTMLInputElement
      | null
    if (!input) return false
    if (!input.checked) input.click()
    return true
  })
  if (!clicked) {
    throw new Error("Schedule checkbox not found")
  }
  await delay(500)
}

async function getScheduleState(page: Page): Promise<ScheduleDomState> {
  return page.evaluate(
    ({ inputSelector, publishButtonSelector }) => {
      const isVisible = (el: Element | null): boolean => {
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        )
      }
      const label = findScheduleLabel()
      const switchEl = closestSwitchTo(label)
      const checkbox = switchEl?.querySelector('input[type="checkbox"]') as
        | HTMLInputElement
        | null
      const switchChecked = Boolean(
        switchEl
          ?.querySelector(".d-switch-simulator")
          ?.classList.contains("checked"),
      )
      const visibleInput = Array.from(document.querySelectorAll(inputSelector))
        .find(isVisible) as HTMLInputElement | undefined
      const publishButton = Array.from(document.querySelectorAll(publishButtonSelector))
        .find(isVisible)
      return {
        checked: Boolean(checkbox?.checked || switchChecked || visibleInput),
        inputValue: visibleInput?.value ?? null,
        hasVisibleDateInput: Boolean(visibleInput),
        publishText: publishButton?.textContent?.trim() ?? null,
      }

      function findScheduleLabel(): Element | null {
        const candidates = Array.from(document.querySelectorAll("span, div, label"))
        return candidates.find((el) => (el.textContent ?? "").trim() === "定时发布") ?? null
      }
      function closestSwitchTo(label: Element | null): Element | null {
        if (!label) return null
        const labelRect = label.getBoundingClientRect()
        const labelY = labelRect.top + labelRect.height / 2
        const switches = Array.from(document.querySelectorAll(".d-switch, [class*='switch']"))
          .filter((el) => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect()
            const br = b.getBoundingClientRect()
            const ay = ar.top + ar.height / 2
            const by = br.top + br.height / 2
            return Math.abs(ay - labelY) - Math.abs(by - labelY)
          })
        return switches[0] ?? null
      }
    },
    {
      inputSelector: DATE_PICKER_INPUT,
      publishButtonSelector: PUBLISH_BTN,
    },
  )
}

async function getDatePickerPoint(page: Page): Promise<PagePoint> {
  return getPoint(page, ({ contentSelector, inputSelector }) => {
    document.querySelector(".post-time-wrapper")?.scrollIntoView({ block: "center" })
    const isVisible = (el: Element | null): boolean => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const label = findScheduleLabel()
    const labelY = label ? centerY(label) : null
    const targets = [
      ...Array.from(document.querySelectorAll(contentSelector)),
      ...Array.from(document.querySelectorAll(inputSelector)),
    ].filter(isVisible)
    const target = labelY === null
      ? targets[0]
      : targets.sort((a, b) => Math.abs(centerY(a) - labelY) - Math.abs(centerY(b) - labelY))[0]
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

    function findScheduleLabel(): Element | null {
      const candidates = Array.from(document.querySelectorAll("span, div, label"))
      return candidates.find((el) => (el.textContent ?? "").trim() === "定时发布") ?? null
    }
    function centerY(el: Element): number {
      const rect = el.getBoundingClientRect()
      return rect.top + rect.height / 2
    }
  }, { contentSelector: DATE_PICKER_CONTENT, inputSelector: DATE_PICKER_INPUT }, "date picker")
}

async function getVisiblePickerMonth(page: Page): Promise<PickerMonth> {
  return page.evaluate((popoverSelector) => {
    const popover = visibleElement(popoverSelector)
    const text =
      popover
        ?.querySelector(".d-datepicker-header-main")
        ?.textContent?.replace(/\s+/g, "") ?? ""
    const match = text.match(/(\d{4})年(\d{1,2})月/)
    if (!match) throw new Error(`Cannot read date picker month: ${text}`)
    return { year: Number(match[1]), month: Number(match[2]) }

    function visibleElement(selector: string): Element | null {
      const candidates = Array.from(document.querySelectorAll(selector))
      return candidates.find((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }) ?? null
    }
  }, SCHEDULE_POPOVER)
}

async function getPickerMonthNavPoint(
  page: Page,
  direction: "next" | "prev",
): Promise<PagePoint> {
  return getPoint(page, ({ popoverSelector, headerSelector, iconSelector, direction }) => {
    const popover = visibleElement(popoverSelector)
    const header = popover?.querySelector(headerSelector)
    const icons = (Array.from(header?.querySelectorAll(iconSelector) ?? []) as Element[])
      .filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    const index =
      direction === "next"
        ? icons.length >= 4 ? 2 : icons.length - 1
        : icons.length >= 4 ? 1 : 0
    const target = icons[index]
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    function visibleElement(selector: string): Element | null {
      return Array.from(document.querySelectorAll(selector)).find(isVisible) ?? null
    }
  }, {
    popoverSelector: SCHEDULE_POPOVER,
    headerSelector: DATE_PICKER_HEADER,
    iconSelector: DATE_PICKER_HEADER_ICON,
    direction,
  }, `month ${direction}`)
}

async function getDateCellPoint(page: Page, day: number): Promise<PagePoint> {
  return getPoint(page, ({ popoverSelector, cellSelector, day }) => {
    const popover = visibleElement(popoverSelector)
    if (!popover) return null
    const cells = Array.from(popover.querySelectorAll(cellSelector))
      .filter(isVisible)
      .filter((el) => !/(disabled|prev|next|outside|not-current)/i.test(el.className.toString()))
    const target = cells.find((el) => (el.textContent ?? "").trim() === String(day))
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    function visibleElement(selector: string): Element | null {
      return Array.from(document.querySelectorAll(selector)).find(isVisible) ?? null
    }
  }, { popoverSelector: SCHEDULE_POPOVER, cellSelector: DATE_PICKER_CELL, day }, `date cell ${day}`)
}

async function getTimeOptionPoint(
  page: Page,
  column: number,
  value: number,
  suffix: "时" | "分",
): Promise<PagePoint> {
  const expected = String(value).padStart(2, "0")
  await page.evaluate(
    ({ popoverSelector, barSelector, optionSelector, column, expected, suffix }) => {
      const popover = visibleElement(popoverSelector)
      if (!popover) return null
      const bars = Array.from(popover.querySelectorAll(barSelector)).filter(isVisible)
      const bar = bars[column]
      if (!bar) return null
      const options = Array.from(bar.querySelectorAll(optionSelector))
      const option = options.find((el) => {
        const text = (el.textContent ?? "").replace(suffix, "").trim()
        return text === expected
      })
      if (!option) return null
      const barEl = bar as HTMLElement
      const optionEl = option as HTMLElement
      barEl.scrollTop =
        optionEl.offsetTop - barEl.clientHeight / 2 + optionEl.offsetHeight / 2
      return null

      function isVisible(el: Element): boolean {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }
      function visibleElement(selector: string): Element | null {
        return Array.from(document.querySelectorAll(selector)).find(isVisible) ?? null
      }
    },
    {
      popoverSelector: SCHEDULE_POPOVER,
      barSelector: TIME_PICKER_BAR,
      optionSelector: TIME_PICKER_OPTION,
      column,
      expected,
      suffix,
    },
  )
  await delay(100)

  return getPoint(page, ({ popoverSelector, barSelector, optionSelector, column, expected, suffix }) => {
    const popover = visibleElement(popoverSelector)
    if (!popover) return null
    const bars = (Array.from(popover.querySelectorAll(barSelector)) as Element[])
      .filter(isVisible)
    const bar = bars[column]
    if (!bar) return null
    const options = Array.from(bar.querySelectorAll(optionSelector)) as Element[]
    const target = options.find((el) => {
      const text = (el.textContent ?? "").replace(suffix, "").trim()
      return text === expected
    })
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    function visibleElement(selector: string): Element | null {
      return Array.from(document.querySelectorAll(selector)).find(isVisible) ?? null
    }
  }, {
    popoverSelector: SCHEDULE_POPOVER,
    barSelector: TIME_PICKER_BAR,
    optionSelector: TIME_PICKER_OPTION,
    column,
    expected,
    suffix,
  }, `time option ${expected}${suffix}`)
}

async function assertScheduleStuck(page: Page, expected: string): Promise<void> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const state = await getScheduleState(page)
    if (
      state.inputValue === expected &&
      state.checked &&
      state.publishText?.includes("定时发布")
    ) {
      return
    }
    await delay(250)
  }

  throw new Error(
    `Schedule did not stick. Expected ${expected}, got ${JSON.stringify(await getScheduleState(page))}`,
  )
}

async function getScheduleInputValue(page: Page): Promise<string | null> {
  const state = await getScheduleState(page)
  return state.inputValue
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

  const publishText = await getVisiblePublishButtonText(page)
  await clickPoint(page, await getPublishButtonPoint(page))

  if (publishText?.includes("定时发布")) {
    await confirmPublishIfPrompted(page)
  }

  await waitForPublishOutcome(page)
}

async function getVisiblePublishButtonText(page: Page): Promise<string | null> {
  return page.evaluate((publishButtonSelector) => {
    const button = Array.from(document.querySelectorAll(publishButtonSelector))
      .find((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      })
    return button?.textContent?.trim() ?? null
  }, PUBLISH_BTN, "publish button")
}

async function getPublishButtonPoint(page: Page): Promise<PagePoint> {
  return getPoint(page, (publishButtonSelector) => {
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      )
    }
    const specific = Array.from(document.querySelectorAll(publishButtonSelector))
      .find((el) => isVisible(el) && el.textContent?.includes("发布"))
    const fallback = Array.from(document.querySelectorAll("button"))
      .find((el) => isVisible(el) && el.textContent?.includes("发布") && !(el as HTMLButtonElement).disabled)
    const target = specific ?? fallback
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, PUBLISH_BTN, "publish button")
}

async function confirmPublishIfPrompted(page: Page): Promise<boolean> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const point = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const modals = Array.from(
        document.querySelectorAll(
          '.d-modal, [class*="modal"], [class*="dialog"], [role="dialog"]',
        ),
      ).filter(isVisible)
      for (const modal of modals) {
        const modalText = modal.textContent ?? ""
        if (!/(定时|预约|发布|确认|确定)/.test(modalText)) continue
        const buttons = Array.from(modal.querySelectorAll("button"))
          .filter((button) => isVisible(button) && !(button as HTMLButtonElement).disabled)
        const target =
          buttons.find((button) => /^(确认|确定)$/.test(button.textContent?.trim() ?? "")) ??
          buttons.find((button) => /(确认|确定|发布|定时发布)/.test(button.textContent ?? ""))
        if (!target) continue
        const rect = target.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      return null
    })
    if (point) {
      await clickPoint(page, point)
      await delay(500)
      return true
    }
    await delay(250)
  }
  return false
}

async function waitForPublishOutcome(page: Page): Promise<void> {
  const deadline = Date.now() + PUBLISH_OUTCOME_TIMEOUT_MS
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const text = document.body.textContent?.replace(/\s+/g, " ").trim() ?? ""
      const visibleModalText = Array.from(
        document.querySelectorAll(
          '.d-modal, [class*="modal"], [class*="dialog"], [role="dialog"]',
        ),
      )
        .filter((el) => {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        })
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .join(" ")
      return { url: location.href, text, visibleModalText }
    })

    if (/发布失败|提交失败|请稍后重试|网络异常|内容违规|操作失败/.test(state.text)) {
      throw new Error(`Publish failed: ${state.text.slice(0, 500)}`)
    }
    if (/发布成功|定时发布成功|已提交|提交成功/.test(state.text)) {
      return
    }
    if (state.url.includes("published=true")) {
      return
    }
    if (!state.url.includes("/publish/publish")) {
      return
    }
    if (state.visibleModalText && !/(确认|确定|知道了|发布|定时)/.test(state.visibleModalText)) {
      throw new Error(`Unexpected publish dialog: ${state.visibleModalText.slice(0, 500)}`)
    }

    await delay(500)
  }

  const state = await page.evaluate(() => ({
    url: location.href,
    text: document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 1000) ?? "",
  }))
  throw new Error(`Publish outcome not confirmed: ${JSON.stringify(state)}`)
}

// ── shared helpers ───────────────────────────────────────────────────

async function getPoint(
  page: Page,
  locator: (args: any) => PagePoint | null,
  args: any,
  label: string,
): Promise<PagePoint> {
  const point = await page.evaluate(locator as any, args) as PagePoint | null
  if (!point) {
    throw new Error(`Clickable point not found: ${label}`)
  }
  return point
}

async function clickPoint(page: Page, point: PagePoint): Promise<void> {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await delay(80)
  await page.mouse.up()
}

async function waitForVisibleSelector(
  page: Page,
  selector: string,
  timeout: number,
): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const candidates = Array.from(document.querySelectorAll(selector))
      return candidates.some((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      })
    },
    { timeout },
    selector,
  )
}

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
