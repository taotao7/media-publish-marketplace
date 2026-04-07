import { existsSync } from "node:fs"
import type { ElementHandle, Page } from "puppeteer"
import { detectLoginStatus } from "./login.js"
import {
  CATEGORY_TRIGGER_SELECTORS,
  CREATOR_UPLOAD_URL,
  DESCRIPTION_INPUT_SELECTORS,
  FILE_INPUT_SELECTORS,
  PUBLISH_BUTTON_SELECTORS,
  PUBLISH_BUTTON_TEXTS,
  PUBLISH_ERROR_TEXTS,
  PUBLISH_PENDING_TEXTS,
  PUBLISH_SUCCESS_TEXTS,
  SCHEDULE_SUBMIT_BUTTON_TEXTS,
  SCHEDULE_SUCCESS_TEXTS,
  SOURCE_INPUT_SELECTORS,
  TAG_INPUT_SELECTORS,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const VIDEO_UPLOAD_TIMEOUT_MS = 15 * 60_000
const PUBLISH_RESULT_TIMEOUT_MS = 2 * 60_000
const SCHEDULE_VERIFY_TIMEOUT_MS = 15_000
const MAX_TITLE_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_TAG_COUNT = 12
const MAX_MONTH_NAVIGATIONS = 12

type SubmitMode = "publish" | "draft" | "schedule"

export interface PublishParams {
  readonly title: string
  readonly description?: string
  readonly videoPath: string
  readonly tags?: readonly string[]
  readonly category?: string
  readonly copyright?: "original" | "repost"
  readonly source?: string
  readonly scheduleAt?: string
  readonly submitMode?: SubmitMode
}

interface ScheduleValues {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly date: string
  readonly time: string
  readonly dateTime: string
}

export async function publishVideo(
  page: Page,
  params: PublishParams,
): Promise<void> {
  validateParams(params)

  await page.goto(CREATOR_UPLOAD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await delay(5_000)

  const status = await detectLoginStatus(page)
  if (!status.loggedIn) {
    throw new Error("Not logged in to Bilibili creator platform. Use get_login_qrcode first.")
  }

  await uploadVideoFile(page, params.videoPath)
  await waitForEditorReady(page)

  await fillTextField(
    page,
    TITLE_INPUT_SELECTORS,
    params.title.slice(0, MAX_TITLE_LENGTH),
    "title",
  )

  if (params.description?.trim()) {
    await fillTextField(
      page,
      DESCRIPTION_INPUT_SELECTORS,
      params.description.slice(0, MAX_DESCRIPTION_LENGTH),
      "description",
    )
  }

  await setCopyright(page, params.copyright ?? "original")

  if ((params.copyright ?? "original") === "repost" && params.source) {
    await fillTextField(page, SOURCE_INPUT_SELECTORS, params.source, "source")
  }

  if (params.category?.trim()) {
    await selectCategory(page, params.category)
  }

  if (params.tags?.length) {
    await fillTags(page, params.tags.slice(0, MAX_TAG_COUNT))
  }

  const submitMode = resolveSubmitMode(params)
  if (submitMode === "schedule") {
    await setSchedule(page, params.scheduleAt ?? "")
  }

  await submitPublish(page, submitMode)

  // Debug: capture page state right after submit click
  await page.screenshot({ path: "/tmp/bili-after-submit.png", fullPage: true }).catch(() => {})

  await waitForPublishResult(page, submitMode)
}

function validateParams(params: PublishParams): void {
  if (!existsSync(params.videoPath)) {
    throw new Error(`Video file not found: ${params.videoPath}`)
  }
  if (!params.title.trim()) {
    throw new Error("title is required")
  }
  if ((params.copyright ?? "original") === "repost" && !params.source?.trim()) {
    throw new Error("source is required when copyright is repost")
  }

  resolveSubmitMode(params)
}

function resolveSubmitMode(params: Pick<PublishParams, "submitMode" | "scheduleAt">): SubmitMode {
  const requestedMode = params.submitMode ?? "publish"
  const hasScheduleAt = Boolean(params.scheduleAt?.trim())

  if (requestedMode === "draft" && hasScheduleAt) {
    throw new Error("scheduleAt cannot be combined with submitMode='draft'")
  }

  if (requestedMode === "schedule" && !hasScheduleAt) {
    throw new Error("scheduleAt is required when submitMode is 'schedule'")
  }

  if (hasScheduleAt) {
    return "schedule"
  }

  return requestedMode
}

async function uploadVideoFile(page: Page, videoPath: string): Promise<void> {
  const input = (await waitForFileInput(page, 30_000)) as ElementHandle<HTMLInputElement> | null
  if (!input) {
    throw new Error("Bilibili video file input not found")
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
    input.uploadFile(videoPath),
  ])
  await delay(2_000)
}

async function waitForEditorReady(page: Page): Promise<void> {
  const deadline = Date.now() + VIDEO_UPLOAD_TIMEOUT_MS

  while (Date.now() < deadline) {
    const titleSelector = await firstExistingSelector(page, TITLE_INPUT_SELECTORS)
    if (titleSelector) {
      return
    }

    const bodyText = await getBodyText(page)
    if (!containsAny(bodyText, PUBLISH_PENDING_TEXTS) && bodyText.includes("稿件标题")) {
      return
    }

    await delay(1_000)
  }

  throw new Error("Timed out waiting for the Bilibili editor after video upload")
}

async function fillTextField(
  page: Page,
  selectors: readonly string[],
  value: string,
  label: string,
): Promise<void> {
  const selector = await waitForFirstSelector(page, selectors, 30_000)
  if (!selector) {
    throw new Error(`Bilibili ${label} field not found`)
  }

  const kind = await page.$eval(selector, (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus()
      element.value = ""
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return "text"
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      return "contenteditable"
    }

    return "unknown"
  })

  if (kind === "text") {
    await page.type(selector, value, { delay: 20 })
  } else {
    await page.click(selector, { clickCount: 3 }).catch(() => {})
    await selectAllAndDelete(page)
    await page.keyboard.type(value, { delay: 20 })
  }

  await delay(300)
}

async function fillTags(page: Page, tags: readonly string[]): Promise<void> {
  const selector = await waitForFirstSelector(page, TAG_INPUT_SELECTORS, 10_000)
  if (!selector) {
    console.error("[bilibili] tag input not found, skipping tags")
    return
  }

  for (const tag of tags) {
    await page.focus(selector)
    await selectAllAndDelete(page)
    await page.keyboard.type(tag, { delay: 20 })
    await page.keyboard.press("Enter")
    await delay(300)
  }
}

async function setCopyright(
  page: Page,
  copyright: "original" | "repost",
): Promise<void> {
  const texts =
    copyright === "repost"
      ? ["转载", "非自制"]
      : ["自制", "原创", "自制原创"]

  const clicked = await clickByTexts(page, texts)
  if (!clicked) {
    console.error(`[bilibili] copyright option '${copyright}' not found, keeping current selection`)
  }
  await delay(500)
}

async function selectCategory(page: Page, category: string): Promise<void> {
  const triggerSelector = await firstExistingSelector(page, CATEGORY_TRIGGER_SELECTORS)
  if (triggerSelector) {
    await page.click(triggerSelector).catch(() => {})
    await delay(500)
  } else {
    const triggerClicked = await clickByTexts(page, ["请选择分区", "分区", "稿件分区"])
    if (!triggerClicked) {
      throw new Error("Bilibili category selector not found")
    }
    await delay(500)
  }

  const segments = category
    .split(/[/>]/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    throw new Error("category cannot be empty")
  }

  for (const segment of segments) {
    const clicked = await clickByTexts(page, [segment], true)
    if (!clicked) {
      throw new Error(`Failed to select Bilibili category segment: ${segment}`)
    }
    await delay(400)
  }
}

async function submitPublish(
  page: Page,
  submitMode: SubmitMode,
): Promise<void> {
  const buttonTexts =
    submitMode === "draft"
      ? (["存草稿"] as const)
      : submitMode === "schedule"
        ? SCHEDULE_SUBMIT_BUTTON_TEXTS
        : PUBLISH_BUTTON_TEXTS

  // Dismiss overlapping notification banners (B站 shows a toast over the submit button)
  await dismissOverlays(page)

  // Scroll the submit area into view
  await page.evaluate(() => {
    const el = document.querySelector(".submit-container, .submit-add, [class*='submit']")
    el?.scrollIntoView({ block: "center" })
  })
  await delay(500)

  // Click submit using mouse coordinates to bypass any remaining overlays
  const clicked = await clickButtonByCoords(page, buttonTexts)
  if (!clicked) {
    // Fallback to selector-based click
    const selector = await firstExistingSelector(page, PUBLISH_BUTTON_SELECTORS)
    if (selector) {
      await page.click(selector)
    } else {
      throw new Error(
        submitMode === "draft"
          ? "Bilibili draft button not found"
          : submitMode === "schedule"
            ? "Bilibili schedule submit button not found"
            : "Bilibili publish button not found",
      )
    }
  }

  await delay(1_000)

  const bodyText = await getBodyText(page)
  if (bodyText.includes("确认投稿") || bodyText.includes("确认发布")) {
    await clickByTexts(page, ["确认投稿", "确认发布", "确认", "继续投稿"])
    await delay(500)
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Close the "信息填完后，就可投稿！不需等待上传完成哦~" banner
    const allElements = Array.from(document.querySelectorAll("*")) as HTMLElement[]
    for (const el of allElements) {
      const text = el.innerText?.trim() ?? ""
      // Look for the × close button on notification banners near the submit area
      if (text === "×" || text === "✕" || text === "x") {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.top > 400) {
          el.click()
        }
      }
    }
  })
  await delay(300)
}

async function clickButtonByCoords(
  page: Page,
  texts: readonly string[],
): Promise<boolean> {
  // Find the target element (span, div, button, or a) with matching text
  const rect = await page.evaluate((candidates) => {
    const nodes = Array.from(
      document.querySelectorAll("button, div, span, a"),
    ) as HTMLElement[]

    const match = nodes
      .filter((node) => {
        const text = node.innerText?.replace(/\s+/g, " ").trim() ?? ""
        if (!text || text.length > 40) return false
        if (node.offsetWidth === 0 || node.offsetHeight === 0) return false
        return candidates.some((c) => text === c)
      })
      // Prefer exact match, then shorter text
      .sort((a, b) => {
        const aText = a.innerText?.replace(/\s+/g, " ").trim() ?? ""
        const bText = b.innerText?.replace(/\s+/g, " ").trim() ?? ""
        return aText.length - bText.length
      })

    const target = match[0]
    if (!target) return null

    target.scrollIntoView({ block: "center" })
    const r = target.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, [...texts])

  if (!rect) return false

  // Wait for scroll to settle, then re-query
  await delay(300)

  const freshRect = await page.evaluate((candidates) => {
    const nodes = Array.from(
      document.querySelectorAll("button, div, span, a"),
    ) as HTMLElement[]
    const match = nodes.find((node) => {
      const text = node.innerText?.replace(/\s+/g, " ").trim() ?? ""
      return text && text.length <= 40 && node.offsetWidth > 0 &&
        candidates.some((c) => text === c)
    })
    if (!match) return null
    const r = match.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, [...texts])

  if (!freshRect) return false

  await page.mouse.click(freshRect.x, freshRect.y)
  return true
}

async function waitForPublishResult(
  page: Page,
  submitMode: SubmitMode,
): Promise<void> {
  const deadline = Date.now() + PUBLISH_RESULT_TIMEOUT_MS
  const startUrl = page.url()
  const successTexts =
    submitMode === "draft"
      ? (["保存成功", "草稿保存成功", "已保存草稿", "已存入草稿箱"] as const)
      : submitMode === "schedule"
        ? ([...SCHEDULE_SUCCESS_TEXTS, ...PUBLISH_SUCCESS_TEXTS] as const)
        : PUBLISH_SUCCESS_TEXTS

  while (Date.now() < deadline) {
    const bodyText = await getBodyText(page)

    if (containsAny(bodyText, successTexts)) {
      return
    }

    if (
      submitMode === "draft" &&
      page.url().includes("/platform/upload-manager/article") &&
      page.url().includes("group=draft")
    ) {
      return
    }

    const hasError = containsAny(bodyText, PUBLISH_ERROR_TEXTS)
    const hasPending = containsAny(bodyText, PUBLISH_PENDING_TEXTS)
    if (hasError && !hasPending) {
      const hit = PUBLISH_ERROR_TEXTS.find((item) => bodyText.includes(item))
      throw new Error(
        submitMode === "draft"
          ? `Bilibili draft save failed: ${hit}`
          : submitMode === "schedule"
            ? `Bilibili schedule publish failed: ${hit}`
            : `Bilibili publish failed: ${hit}`,
      )
    }

    if (page.url() !== startUrl && !page.url().includes("/platform/upload/video/frame")) {
      return
    }

    await delay(1_000)
  }

  throw new Error(
    submitMode === "draft"
      ? "Timed out waiting for the Bilibili draft result"
      : submitMode === "schedule"
        ? "Timed out waiting for the Bilibili schedule publish result"
        : "Timed out waiting for the Bilibili publish result",
  )
}

async function setSchedule(page: Page, isoDate: string): Promise<void> {
  const schedule = parseScheduleAt(isoDate)

  // Step 1: click the switch to enable schedule
  const switchSelector = ".time-switch-wrp .switch-container"
  const switchHandle = await page.waitForSelector(switchSelector, { timeout: 10_000 }).catch(() => null)
  if (!switchHandle) {
    throw new Error("Bilibili schedule switch (.switch-container) not found")
  }

  const alreadyActive = await page.$eval(switchSelector, (el) =>
    el.classList.contains("switch-container-active"),
  ).catch(() => false)

  if (!alreadyActive) {
    await page.click(switchSelector)
    await delay(800)
  }

  // Wait for time-picker to appear
  await page.waitForSelector(".time-picker .date-picker-date", { timeout: 10_000 }).catch(() => null)

  // Step 2: pick the date
  await pickScheduleDate(page, schedule)
  await delay(400)

  // Step 3: pick the time (hour + minute)
  await pickScheduleTime(page, schedule)
  await delay(400)

  // Step 4: verify values
  await ensureScheduleValues(page, schedule)
}

async function pickScheduleDate(page: Page, schedule: ScheduleValues): Promise<void> {
  // Read current date shown in .date-picker-date > .date-show
  const currentDate = await page
    .$eval(".date-picker-date .date-show", (el) => (el as HTMLElement).innerText.trim())
    .catch(() => "")

  if (currentDate === schedule.date) {
    return
  }

  // Open the date picker
  await page.click(".date-picker-date")
  await delay(500)

  // Navigate to the correct month using the nav buttons
  for (let i = 0; i < MAX_MONTH_NAVIGATIONS; i++) {
    const navTitle = await page
      .$eval(".date-picker-nav-title", (el) => (el as HTMLElement).innerText.trim())
      .catch(() => "")

    const match = navTitle.match(/(\d+)\D+(\d+)/)
    if (!match) break

    const navYear = Number.parseInt(match[1] ?? "", 10)
    const navMonth = Number.parseInt(match[2] ?? "", 10)
    if (!Number.isFinite(navYear) || !Number.isFinite(navMonth)) break

    if (navYear === schedule.year && navMonth === schedule.month) {
      break
    }

    const target = schedule.year * 12 + schedule.month
    const current = navYear * 12 + navMonth
    const forward = target > current

    const clicked = await clickMonthNav(page, forward)
    if (!clicked) {
      throw new Error(`Failed to navigate Bilibili schedule date picker to ${schedule.year}-${schedule.month}`)
    }
    await delay(300)
  }

  // Click the day cell
  const dayClicked = await page.evaluate((day) => {
    const items = Array.from(document.querySelectorAll(".date-wrp .date-picker-body-item")) as HTMLElement[]
    for (const item of items) {
      if (item.classList.contains("date-item-disabled")) continue
      const text = item.innerText?.trim() ?? ""
      if (text === String(day)) {
        item.click()
        return true
      }
    }
    return false
  }, schedule.day)

  if (!dayClicked) {
    throw new Error(
      `Bilibili schedule day ${schedule.day} not selectable (may be disabled or outside the 15-day window)`,
    )
  }

  await delay(500)
}

async function clickMonthNav(page: Page, forward: boolean): Promise<boolean> {
  return page.evaluate((goForward) => {
    const nav = document.querySelector(".date-picker-nav-wrp") as HTMLElement | null
    if (!nav) return false

    // Nav bar has arrow SVGs: two prev arrows on the left, title, two next arrows on the right.
    // Use the inner (single-step) arrows: index 1 (prev month) / index 2 (next month).
    const svgs = Array.from(nav.querySelectorAll("svg")) as SVGElement[]
    if (svgs.length < 4) return false

    const targetSvg = goForward ? svgs[2] : svgs[1]
    if (!targetSvg) return false

    // Dispatch click on the svg's clickable ancestor (often itself or parent)
    const clickable = (targetSvg.closest("svg, button, [class*='nav']") as HTMLElement) ?? targetSvg
    ;(clickable as unknown as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    )
    return true
  }, forward)
}

async function pickScheduleTime(page: Page, schedule: ScheduleValues): Promise<void> {
  // Read current time shown
  const currentTime = await page
    .$eval(".date-picker-timer .date-show", (el) => (el as HTMLElement).innerText.trim())
    .catch(() => "")

  if (currentTime === schedule.time) {
    return
  }

  // Open the time picker
  await page.click(".date-picker-timer")
  await delay(500)

  const hourStr = String(schedule.hour).padStart(2, "0")
  const minuteStr = String(schedule.minute).padStart(2, "0")

  // Bilibili's minute panel only enables minutes >= current-time-constraint
  // based on the currently active hour. We must click hour FIRST, let the
  // minute panel re-render, then click minute.
  const hourResult = await page.evaluate((target) => {
    const panels = Array.from(
      document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp"),
    ) as HTMLElement[]
    if (panels.length < 2) return { found: false, reason: "panels<2" }

    const items = Array.from(
      panels[0]!.querySelectorAll("span.time-picker-panel-select-item"),
    ) as HTMLElement[]
    for (const item of items) {
      if (item.classList.contains("time-select-disabled")) continue
      if ((item.innerText ?? "").trim() === target) {
        item.click()
        return { found: true }
      }
    }
    return { found: false, reason: "hour not enabled" }
  }, hourStr)

  if (!hourResult.found) {
    throw new Error(`Bilibili schedule hour ${hourStr} not selectable (may be disabled)`)
  }

  // Wait for the minute panel to re-render with updated disabled state
  await delay(400)

  const minuteResult = await page.evaluate((target) => {
    const panels = Array.from(
      document.querySelectorAll(".time-picker-body-wrp .time-picker-panel-select-wrp"),
    ) as HTMLElement[]
    if (panels.length < 2) return { found: false, reason: "panels<2" }

    const items = Array.from(
      panels[1]!.querySelectorAll("span.time-picker-panel-select-item"),
    ) as HTMLElement[]
    const enabledList: string[] = []
    for (const item of items) {
      const text = (item.innerText ?? "").trim()
      if (!item.classList.contains("time-select-disabled")) {
        enabledList.push(text)
      }
      if (item.classList.contains("time-select-disabled")) continue
      if (text === target) {
        item.click()
        return { found: true }
      }
    }
    return { found: false, reason: "minute not enabled", enabled: enabledList }
  }, minuteStr)

  if (!minuteResult.found) {
    throw new Error(
      `Bilibili schedule minute ${minuteStr} not selectable. Bilibili only allows 5-minute steps (00,05,10,...). Enabled: ${JSON.stringify(
        (minuteResult as { enabled?: string[] }).enabled ?? [],
      )}`,
    )
  }

  // Close the time picker by clicking somewhere neutral
  await delay(300)
  await page.evaluate(() => {
    (document.querySelector(".section-title-content-main") as HTMLElement | null)?.click()
  })
  await delay(300)
}

async function waitForFileInput(
  page: Page,
  timeoutMs: number,
): Promise<ElementHandle | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    for (const selector of FILE_INPUT_SELECTORS) {
      const handles = await page.$$(selector)
      for (const handle of handles) {
        const usable = await handle
          .evaluate((el) => {
            if (!(el instanceof HTMLInputElement)) return false
            if (el.disabled) return false
            const accept = el.accept.toLowerCase()
            return accept.includes("video") || accept.includes("mp4") || accept.length === 0
          })
          .catch(() => false)

        if (usable) {
          return handle
        }
      }
    }
    await delay(500)
  }

  return null
}

async function waitForFirstSelector(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const selector = await firstExistingSelector(page, selectors)
    if (selector) return selector
    await delay(300)
  }

  return null
}

async function firstExistingSelector(
  page: Page,
  selectors: readonly string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector)
    if (handle) {
      await handle.dispose()
      return selector
    }
  }
  return null
}

async function clickByTexts(
  page: Page,
  texts: readonly string[],
  exact: boolean = false,
): Promise<boolean> {
  return page.evaluate(
    ({ candidates, exactMatch }) => {
      const nodes = Array.from(
        document.querySelectorAll("button, div, span, a, li, label"),
      ) as HTMLElement[]
      const matches = nodes
        .map((node) => {
          const text = node.innerText?.replace(/\s+/g, " ").trim() ?? ""
          return { node, text }
        })
        .filter(({ node, text }) => {
          if (!text) return false
          if (node.offsetWidth === 0 || node.offsetHeight === 0) return false
          if (text.length > 40) return false
          return candidates.some((candidate) =>
            exactMatch ? text === candidate : text.includes(candidate),
          )
        })
        .sort((left, right) => left.text.length - right.text.length)

      const target = matches[0]?.node
      if (!target) return false

      target.scrollIntoView({ block: "center", inline: "center" })
      target.click()
      return true
    },
    { candidates: [...texts], exactMatch: exact },
  )
}

async function getBodyText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
  } catch {
    return ""
  }
}

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function parseScheduleAt(isoDate: string): ScheduleValues {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`scheduleAt is not a valid ISO 8601 date: ${isoDate}`)
  }

  if (d.getTime() <= Date.now() + 5 * 60_000) {
    throw new Error(
      `scheduleAt must be at least 5 minutes in the future (Bilibili requirement). Got: ${isoDate}`,
    )
  }

  if (d.getMinutes() % 5 !== 0) {
    throw new Error(
      `scheduleAt minute must be a multiple of 5 (Bilibili only allows 5-minute steps). Got: ${isoDate}`,
    )
  }

  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hour = d.getHours()
  const minute = d.getMinutes()

  const date = [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-")
  const time = [
    String(hour).padStart(2, "0"),
    String(minute).padStart(2, "0"),
  ].join(":")

  return {
    year,
    month,
    day,
    hour,
    minute,
    date,
    time,
    dateTime: `${date} ${time}`,
  }
}

async function ensureScheduleValues(
  page: Page,
  schedule: ScheduleValues,
): Promise<void> {
  const deadline = Date.now() + SCHEDULE_VERIFY_TIMEOUT_MS

  while (Date.now() < deadline) {
    const [dateShown, timeShown] = await page.evaluate(() => {
      const dateEl = document.querySelector(".date-picker-date .date-show") as HTMLElement | null
      const timeEl = document.querySelector(".date-picker-timer .date-show") as HTMLElement | null
      return [
        dateEl?.innerText?.trim() ?? "",
        timeEl?.innerText?.trim() ?? "",
      ]
    })

    if (dateShown === schedule.date && timeShown === schedule.time) {
      return
    }

    await delay(300)
  }

  const [dateShown, timeShown] = await page.evaluate(() => {
    const dateEl = document.querySelector(".date-picker-date .date-show") as HTMLElement | null
    const timeEl = document.querySelector(".date-picker-timer .date-show") as HTMLElement | null
    return [
      dateEl?.innerText?.trim() ?? "",
      timeEl?.innerText?.trim() ?? "",
    ]
  })

  throw new Error(
    `Failed to confirm Bilibili schedule value. expected=${schedule.dateTime} actual=${dateShown} ${timeShown}`,
  )
}

async function selectAllAndDelete(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.down(modifier)
  await page.keyboard.press("A")
  await page.keyboard.up(modifier)
  await page.keyboard.press("Backspace")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
