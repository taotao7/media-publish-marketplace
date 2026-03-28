import { existsSync } from "node:fs"
import type { ElementHandle, Page } from "puppeteer"
import { detectLoginStatus } from "./login.js"
import {
  ADD_MORE_IMAGES_BUTTON_SELECTOR,
  CREATOR_UPLOAD_URL,
  DESCRIPTION_INPUT_SELECTORS,
  FILE_INPUT_SELECTORS,
  IMAGE_FILE_INPUT_SELECTORS,
  IMAGE_TAB_SELECTOR,
  IMAGE_TAB_TEXTS,
  IMAGE_UPLOADED_INDICATOR_SELECTOR,
  MUSIC_PICKER_SELECTOR,
  MUSIC_SELECT_TEXTS,
  PUBLISH_BUTTON_SELECTORS,
  PROGRESS_SELECTORS,
  SCHEDULE_INPUT_SELECTOR,
  SCHEDULE_RADIO_TEXT,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const VIDEO_UPLOAD_TIMEOUT_MS = 300_000
const IMAGE_UPLOAD_TIMEOUT_MS = 60_000
const SUBMIT_READY_TIMEOUT_MS = 300_000
const PUBLISH_RESULT_TIMEOUT_MS = 120_000
const MAX_TITLE_LENGTH = 60
const MAX_CONTENT_LENGTH = 1_000

const PUBLISH_PENDING_TEXTS = [
  "上传中",
  "正在上传",
  "处理中",
  "正在处理",
  "提交中",
  "发布中",
  "请稍候",
  "上传还未完成",
  "素材处理中",
  "封面处理中",
  "转码中",
] as const

const PUBLISH_ERROR_TEXTS = [
  "失败",
  "错误",
  "不能为空",
  "请填写",
  "小于2小时",
  "重新设置",
  "上传还未完成",
  "审核失败",
  "无法发布",
  "上传失败",
] as const

const PUBLISH_SUCCESS_TEXTS = [
  "发布成功",
  "提交成功",
  "定时发布成功",
  "已安排发布",
  "预约成功",
  "已提交",
] as const

export interface PublishParams {
  readonly title: string
  readonly content?: string
  readonly videoPath: string
  readonly tags?: readonly string[]
  readonly visibility?: "public" | "private"
  readonly scheduleAt?: string
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
    throw new Error("Not logged in to Douyin creator platform. Use get_login_qrcode first.")
  }

  await uploadVideoFile(page, params.videoPath)
  await waitForEditorReady(page)

  await fillTextField(page, TITLE_INPUT_SELECTORS, params.title.slice(0, MAX_TITLE_LENGTH))

  const descriptionWithTags = buildDescriptionWithTags(params.content, params.tags)
  if (descriptionWithTags) {
    await fillTextField(
      page,
      DESCRIPTION_INPUT_SELECTORS,
      descriptionWithTags.slice(0, MAX_CONTENT_LENGTH),
      { optional: true },
    )
  }

  if (params.visibility === "private") {
    const privateSet = await clickByTexts(page, ["私密", "仅自己可见", "私密仅自己可见"])
    if (!privateSet) {
      console.error("[douyin] private visibility option not found, keeping default visibility")
    }
    await delay(800)
  }

  if (params.scheduleAt) {
    await setSchedule(page, params.scheduleAt)
  }

  await submitPublishWhenReady(page)

  await waitForPublishSuccess(page)
}

export interface PublishImagesParams {
  readonly title: string
  readonly content?: string
  readonly imagePaths: readonly string[]
  readonly tags?: readonly string[]
  readonly visibility?: "public" | "private"
  readonly scheduleAt?: string
}

export async function publishImages(
  page: Page,
  params: PublishImagesParams,
): Promise<void> {
  if (params.imagePaths.length === 0) {
    throw new Error("At least one image is required")
  }
  for (const img of params.imagePaths) {
    if (!existsSync(img)) {
      throw new Error(`Image file not found: ${img}`)
    }
  }
  if (!params.title.trim()) {
    throw new Error("title is required")
  }

  await page.goto(CREATOR_UPLOAD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await delay(5_000)

  const status = await detectLoginStatus(page)
  if (!status.loggedIn) {
    throw new Error("Not logged in to Douyin creator platform. Use get_login_qrcode first.")
  }

  // Switch to image/图文 tab — try specific selector first, then text fallback
  const tabHandle = await page.$(IMAGE_TAB_SELECTOR)
  if (tabHandle) {
    await tabHandle.click().catch(() => {})
    await tabHandle.dispose()
    await delay(2_000)
  } else {
    const switched = await clickByTexts(page, [...IMAGE_TAB_TEXTS])
    if (switched) {
      await delay(2_000)
    } else {
      console.error("[douyin] image tab not found — assuming already on image upload")
    }
  }

  // Upload all images — after the first upload the page navigates to /content/post/image
  for (let i = 0; i < params.imagePaths.length; i++) {
    if (i === 0) {
      // First image: find the input on the initial upload page, upload triggers navigation
      const input = (await waitForFirstHandle(
        page,
        IMAGE_FILE_INPUT_SELECTORS,
        30_000,
      )) as ElementHandle<HTMLInputElement> | null
      if (!input) throw new Error("Image file input not found")

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
        input.uploadFile(params.imagePaths[i]),
      ])
      await delay(3_000)
    } else {
      // Subsequent images: wait for previous upload, click "继续添加", intercept file chooser
      await waitForImageUploaded(page, i)

      const addBtn = await page.$(ADD_MORE_IMAGES_BUTTON_SELECTOR)
      if (!addBtn) {
        throw new Error(`继续添加 button not found for image index ${i}`)
      }

      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 5_000 }),
        addBtn.click(),
      ])
      await chooser.accept([params.imagePaths[i]])
      await delay(2_000)
    }
  }
  await waitForImageUploaded(page, params.imagePaths.length)

  // Auto-select music
  await selectMusic(page)

  await fillTextField(page, TITLE_INPUT_SELECTORS, params.title.slice(0, MAX_TITLE_LENGTH))

  const descriptionWithTags = buildDescriptionWithTags(params.content, params.tags)
  if (descriptionWithTags) {
    await fillTextField(
      page,
      DESCRIPTION_INPUT_SELECTORS,
      descriptionWithTags.slice(0, MAX_CONTENT_LENGTH),
      { optional: true },
    )
  }

  if (params.visibility === "private") {
    const privateSet = await clickByTexts(page, ["私密", "仅自己可见", "私密仅自己可见"])
    if (!privateSet) {
      console.error("[douyin] private visibility option not found, keeping default visibility")
    }
    await delay(800)
  }

  if (params.scheduleAt) {
    await setSchedule(page, params.scheduleAt)
  }

  await submitPublishWhenReady(page)

  await waitForPublishSuccess(page)
}

async function waitForImageUploaded(page: Page, expectedCount: number): Promise<void> {
  const deadline = Date.now() + IMAGE_UPLOAD_TIMEOUT_MS
  while (Date.now() < deadline) {
    const count = await page.evaluate((sel) => {
      try { return document.querySelectorAll(sel).length } catch { return 0 }
    }, IMAGE_UPLOADED_INDICATOR_SELECTOR).catch(() => 0)
    if (count >= expectedCount) return
    await delay(500)
  }
  throw new Error(`Image upload timed out waiting for ${expectedCount} uploaded thumbnail(s)`)
}

function validateParams(params: PublishParams): void {
  if (!params.title.trim()) {
    throw new Error("title is required")
  }

  if (!existsSync(params.videoPath)) {
    throw new Error(`Video file not found: ${params.videoPath}`)
  }
}

async function uploadVideoFile(page: Page, videoPath: string): Promise<void> {
  const input = (await waitForFirstHandle(
    page,
    FILE_INPUT_SELECTORS,
    30_000,
  )) as ElementHandle<HTMLInputElement> | null

  if (!input) {
    throw new Error("Douyin video file input not found")
  }

  await input.uploadFile(videoPath)
}

async function waitForEditorReady(page: Page): Promise<void> {
  const deadline = Date.now() + VIDEO_UPLOAD_TIMEOUT_MS
  let formVisibleAt = 0
  let readySince = 0
  let sawProcessing = false
  let lastProcessingText = ""

  while (Date.now() < deadline) {
    const titleSelector = await firstExistingSelector(page, TITLE_INPUT_SELECTORS)
    const descriptionSelector = await firstExistingSelector(
      page,
      DESCRIPTION_INPUT_SELECTORS,
    )

    if (titleSelector || descriptionSelector) {
      if (!formVisibleAt) {
        formVisibleAt = Date.now()
      }

      // Form is visible — only proceed when upload/processing has finished
      const processingText = await getProcessingText(page)
      if (processingText) {
        sawProcessing = true
        readySince = 0
        if (processingText !== lastProcessingText) {
          console.error(`[douyin] upload progress: ${processingText}`)
          lastProcessingText = processingText
        }
      } else {
        if (!readySince) {
          readySince = Date.now()
        }

        const stableWindowMs = sawProcessing ? 3_000 : 5_000
        if (
          Date.now() - readySince >= stableWindowMs &&
          Date.now() - formVisibleAt >= 3_000
        ) {
          return
        }
      }
    }

    await delay(1_500)
  }

  throw new Error("Timed out waiting for Douyin upload form to become ready")
}

async function fillTextField(
  page: Page,
  selectors: readonly string[],
  value: string,
  options: { optional?: boolean } = {},
): Promise<void> {
  const selector = await firstExistingSelector(page, selectors)
  if (!selector) {
    if (options.optional) return
    throw new Error(`Field not found for selectors: ${selectors.join(", ")}`)
  }

  const handle = await page.$(selector)
  if (!handle) {
    if (options.optional) return
    throw new Error(`Field handle missing for selector: ${selector}`)
  }

  await handle.click({ clickCount: 3 }).catch(async () => {
    await page.focus(selector)
  })

  const isPlainInput = await handle.evaluate(
    (element) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
  )

  if (isPlainInput) {
    await page.evaluate(
      (targetSelector) => {
        const element = document.querySelector(targetSelector)
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          element.value = ""
          element.dispatchEvent(new Event("input", { bubbles: true }))
          element.dispatchEvent(new Event("change", { bubbles: true }))
        }
      },
      selector,
    )
  } else {
    await handle.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.textContent = ""
        element.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
  }

  await handle.click().catch(() => {})
  await page.keyboard.type(value, { delay: 20 })
}

function buildDescriptionWithTags(
  content: string | undefined,
  tags: readonly string[] | undefined,
): string {
  const parts: string[] = []

  if (content && content.trim()) {
    parts.push(content.trim())
  }

  const cleanTags = (tags ?? [])
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 5)

  if (cleanTags.length > 0) {
    parts.push(cleanTags.map((tag) => `#${tag}`).join(" ") + " ")
  }

  return parts.join("\n")
}

async function clickPublishButton(page: Page): Promise<boolean> {
  const selector = await firstExistingSelector(page, PUBLISH_BUTTON_SELECTORS)
  if (selector) {
    const handle = await page.$(selector)
    const canClick = await handle?.evaluate((element) => {
      const htmlElement = element as HTMLElement
      const style = window.getComputedStyle(htmlElement)
      const rect = htmlElement.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !htmlElement.hasAttribute("disabled")
      )
    })

    if (canClick) {
      console.error(`[douyin] clicking publish button via selector: ${selector}`)
      await handle
        ?.evaluate((element) => {
          ;(element as HTMLElement).click()
        })
        .catch(() => {})
      return true
    }
  }

  const clicked = await clickByTexts(page, ["发布", "立即发布", "发布作品"])
  if (clicked) {
    console.error("[douyin] clicking publish button via text fallback")
  }
  return clicked
}

async function clickByTexts(
  page: Page,
  texts: readonly string[],
): Promise<boolean> {
  return page.evaluate((candidates) => {
    const elements = Array.from(
      document.querySelectorAll("button, [role='button'], label, span, div, a"),
    )

    const isVisible = (element: Element): boolean => {
      const htmlElement = element as HTMLElement
      const style = window.getComputedStyle(htmlElement)
      const rect = htmlElement.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      )
    }

    for (const element of elements) {
      const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
      if (!text || !isVisible(element)) continue
      if (candidates.some((candidate) => text === candidate)) {
        ;(element as HTMLElement).click()
        return true
      }
    }

    return false
  }, [...texts])
}

async function getProgressText(page: Page): Promise<string | null> {
  for (const selector of PROGRESS_SELECTORS) {
    const handle = await page.$(selector)
    if (handle) {
      const text = await handle.evaluate((element) => element.textContent?.trim() ?? "")
      await handle.dispose()
      const normalized = normalizeStatusText(text)
      if (normalized) return normalized
    }
  }

  return null
}

async function getProcessingText(page: Page): Promise<string | null> {
  const progressText = await getProgressText(page)
  if (progressText) {
    return progressText
  }

  return findVisibleTextMatch(page, PUBLISH_PENDING_TEXTS)
}

async function submitPublishWhenReady(
  page: Page,
  timeoutMs = SUBMIT_READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastStatus = ""
  let clearPolls = 0

  while (Date.now() < deadline) {
    await dismissBlockingOverlays(page)

    const processingText = await getProcessingText(page)

    if (!processingText) {
      clearPolls += 1
      if (clearPolls >= 2) {
        const published = await clickPublishButton(page)
        if (published) {
          return
        }
      }
    } else {
      clearPolls = 0
    }

    const status = processingText ?? "publish button not ready"
    if (status !== lastStatus) {
      console.error(`[douyin] waiting before submit: ${status}`)
      lastStatus = status
    }

    await delay(1_500)
  }

  throw new Error("Timed out waiting for Douyin publish action to become available")
}

async function dismissBlockingOverlays(page: Page): Promise<void> {
  while (true) {
    const dismissed = await page.evaluate(() => {
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement
        const style = window.getComputedStyle(htmlElement)
        const rect = htmlElement.getBoundingClientRect()
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        )
      }

      const candidates = Array.from(
        document.querySelectorAll("button, [role='button']"),
      )

      for (const element of candidates) {
        const htmlElement = element as HTMLElement
        const text = htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? ""
        const inOverlay = Boolean(
          htmlElement.closest(
            "[role='dialog'], [class*='modal'], [class*='dialog'], [class*='shepherd']",
          ),
        )

        if (!isVisible(element)) {
          continue
        }

        const shouldClick =
          text === "我知道了" ||
          text === "知道了" ||
          text === "跳过" ||
          text === "关闭" ||
          (text === "" &&
            (htmlElement.className.includes("shepherd") ||
              htmlElement.className.includes("icon-div")))

        if (!shouldClick) {
          continue
        }

        if (!inOverlay && text !== "我知道了" && text !== "知道了") {
          continue
        }

        htmlElement.click()
        return true
      }

      return false
    }).catch(() => false)

    if (!dismissed) {
      return
    }

    console.error("[douyin] dismissed blocking overlay")
    await delay(400)
  }
}

async function waitForFirstHandle(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<ElementHandle<Element> | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const selector = await firstExistingSelector(page, selectors)
    if (selector) {
      const handle = await page.$(selector)
      if (handle) {
        return handle
      }
    }
    await delay(500)
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

async function selectMusic(page: Page): Promise<void> {
  // Click the action "选择音乐" span — last span with that text (the button, not the label)
  const opened = await page.evaluate((texts: readonly string[]) => {
    const spans = Array.from(document.querySelectorAll("span"))
      .filter((el) => {
        const text = el.textContent?.trim() ?? ""
        const r = el.getBoundingClientRect()
        return texts.includes(text) && r.width > 0 && r.height > 0
      })
    if (spans.length === 0) return false
    ;(spans[spans.length - 1] as HTMLElement).click()
    return true
  }, [...MUSIC_SELECT_TEXTS])

  if (!opened) {
    console.error("[douyin] 选择音乐 span not found, skipping music selection")
    return
  }

  // Wait for music picker drawer to appear
  const picker = await page.waitForSelector(MUSIC_PICKER_SELECTOR, { timeout: 5_000 }).catch(() => null)
  if (!picker) {
    console.error("[douyin] music picker did not open, skipping music selection")
    return
  }
  await delay(1_500)

  // Hover over the first track to reveal its "使用" button, then click it
  const firstTrack = await page.$("[class*='song-name'], [class*='song-info']")
  if (!firstTrack) {
    console.error("[douyin] no track found in music picker, skipping music selection")
    return
  }

  await firstTrack.hover()
  await delay(500)

  const used = await page.evaluate(() => {
    // After hover, "使用" buttons should be visible
    const buttons = Array.from(document.querySelectorAll("button[class*='apply-btn']"))
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        ;(btn as HTMLElement).click()
        return true
      }
    }
    // Fallback: just click the first apply-btn regardless of visibility
    const first = document.querySelector("button[class*='apply-btn']") as HTMLElement | null
    if (first) { first.click(); return true }
    return false
  })

  if (!used) {
    console.error("[douyin] 使用 button not found in music picker, skipping music selection")
    return
  }

  await delay(1_500)
  console.error("[douyin] music selected")
}

async function setSchedule(page: Page, isoDate: string): Promise<void> {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`scheduleAt is not a valid ISO 8601 date: ${isoDate}`)
  }

  const minScheduleMs = 2 * 60 * 60 * 1000 + 5 * 60 * 1000 // 2h5m buffer
  if (d.getTime() - Date.now() < minScheduleMs) {
    throw new Error(`scheduleAt must be at least 2 hours in the future (Douyin requirement). Got: ${isoDate}`)
  }

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

  // Click "定时发布" radio
  const switched = await page.evaluate((text) => {
    const els = Array.from(document.querySelectorAll("span, label, div"))
    for (const el of els) {
      if (el.textContent?.trim() === text && el.children.length <= 1) {
        ;(el as HTMLElement).click()
        return true
      }
    }
    return false
  }, SCHEDULE_RADIO_TEXT)

  if (!switched) {
    throw new Error("定时发布 radio not found")
  }
  await delay(1_000)

  // Fill date/time input
  const input = await page.waitForSelector(SCHEDULE_INPUT_SELECTOR, { timeout: 5_000 })
  if (!input) throw new Error("Schedule date/time input not found")

  await input.click({ clickCount: 3 })
  await delay(200)
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })) }
  }, SCHEDULE_INPUT_SELECTOR)
  await input.type(formatted, { delay: 30 })
  await page.keyboard.press("Enter")
  await delay(500)
}

async function checkPublishError(page: Page): Promise<void> {
  const errorText = await findVisibleTextMatch(page, PUBLISH_ERROR_TEXTS)
  if (errorText) {
    throw new Error(`Douyin publish error: ${errorText}`)
  }
}

async function waitForPublishSuccess(
  page: Page,
  timeoutMs = PUBLISH_RESULT_TIMEOUT_MS,
): Promise<void> {
  const startUrl = page.url()
  const deadline = Date.now() + timeoutMs
  let lastPending = ""

  while (Date.now() < deadline) {
    await dismissBlockingOverlays(page)
    await checkPublishError(page)

    const currentUrl = page.url()
    if (currentUrl !== startUrl && !currentUrl.includes("/post/")) {
      console.error(`[douyin] publish success, navigated to: ${currentUrl}`)
      return
    }

    const successText = await findVisibleTextMatch(page, PUBLISH_SUCCESS_TEXTS)
    if (successText) {
      console.error(`[douyin] publish success: ${successText}`)
      return
    }

    const pendingText = await getProcessingText(page)
    if (pendingText && pendingText !== lastPending) {
      console.error(`[douyin] publish pending: ${pendingText}`)
      lastPending = pendingText
    }

    await delay(1_000)
  }

  const bodySnippet = await page.evaluate(
    () => document.body.innerText.replace(/\s+/g, " ").slice(0, 200)
  ).catch(() => "")
  const debugSnapshot = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
      .map((element) => {
        const htmlElement = element as HTMLElement
        const text = htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? ""
        const style = window.getComputedStyle(htmlElement)
        const rect = htmlElement.getBoundingClientRect()
        return {
          text: text.slice(0, 40),
          className: htmlElement.className.slice(0, 80),
          disabled:
            htmlElement.hasAttribute("disabled") ||
            htmlElement.getAttribute("aria-disabled") === "true",
          visible:
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0,
        }
      })
      .filter((item) => item.visible)
      .slice(0, 8)

    const dialogs = Array.from(
      document.querySelectorAll("[role='dialog'], [class*='modal'], [class*='dialog']"),
    )
      .map((element) => {
        const htmlElement = element as HTMLElement
        const text = htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? ""
        return text.slice(0, 120)
      })
      .filter(Boolean)
      .slice(0, 5)

    return { buttons, dialogs }
  }).catch(() => ({ buttons: [], dialogs: [] }))

  throw new Error(
    `Timed out waiting for Douyin publish confirmation. url=${page.url()} body=${bodySnippet} buttons=${JSON.stringify(debugSnapshot.buttons)} dialogs=${JSON.stringify(debugSnapshot.dialogs)}`,
  )
}

async function findVisibleTextMatch(
  page: Page,
  keywords: readonly string[],
): Promise<string | null> {
  return page
    .evaluate((candidates) => {
      const elements = Array.from(
        document.querySelectorAll("div, span, p, button, a, li"),
      )

      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement
        const style = window.getComputedStyle(htmlElement)
        const rect = htmlElement.getBoundingClientRect()
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        )
      }

      for (const element of elements) {
        const htmlElement = element as HTMLElement
        const text = htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? ""
        if (!text || text.length > 80 || !isVisible(element)) {
          continue
        }
        if (htmlElement.childElementCount > 1) {
          continue
        }
        if (candidates.some((candidate) => text.includes(candidate))) {
          return text.slice(0, 120)
        }
      }

      return null
    }, [...keywords])
    .then((text) => (text ? normalizeStatusText(text) : null))
    .catch(() => null)
}

function normalizeStatusText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return null
  }

  if (isAdvisoryStatusText(normalized)) {
    return null
  }

  return normalized
}

function isAdvisoryStatusText(text: string): boolean {
  return text.includes("点击发布后，如作品还在上传中，请勿关闭页面，等待上传发布完成")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
