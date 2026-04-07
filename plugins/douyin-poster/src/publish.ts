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
  IMAGE_UPLOADED_INDICATOR_SELECTORS,
  MUSIC_PICKER_SELECTOR,
  MUSIC_SELECT_TEXTS,
  PUBLISH_BUTTON_SELECTORS,
  PROGRESS_SELECTORS,
  SCHEDULE_INPUT_SELECTOR,
  SCHEDULE_RADIO_TEXT,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const VIDEO_UPLOAD_TIMEOUT_MS = 300_000
const IMAGE_UPLOAD_TIMEOUT_MS = 180_000
const IMAGE_UPLOAD_STABLE_WINDOW_MS = 800
const IMAGE_UPLOAD_NEXT_DELAY_MS = 500
const SUBMIT_READY_TIMEOUT_MS = 300_000
const PUBLISH_RESULT_TIMEOUT_MS = 120_000
const MAX_TITLE_LENGTH = 60
const MAX_CONTENT_LENGTH = 1_000
const READINESS_STABLE_POLLS = 2
const PREPARE_RETRY_ATTEMPTS = 2
const PREPARE_RETRY_DELAY_MS = 2_000
const VIDEO_READY_HINT_TEXTS = ["设置封面", "选择封面", "发布时间"] as const
const MANAGE_PAGE_READY_TEXTS = ["作品管理", "全部作品", "已发布", "审核中"] as const

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

interface PublishReadinessRequirements {
  readonly mode: "video" | "image"
  readonly expectedTitle: string
  readonly expectedDescription?: string
  readonly expectedImageCount?: number
}

interface FieldSnapshot {
  readonly selector: string
  readonly tagName: string
  readonly value: string
  readonly visible: boolean
  readonly disabled: boolean
}

interface ButtonSnapshot {
  readonly selector: string | null
  readonly text: string
  readonly visible: boolean
  readonly disabled: boolean
}

interface PublishReadinessSnapshot {
  readonly ready: boolean
  readonly processingText: string | null
  readonly titleField: FieldSnapshot | null
  readonly descriptionField: FieldSnapshot | null
  readonly publishButton: ButtonSnapshot | null
  readonly imageCount: number
  readonly videoHintText: string | null
  readonly status: string
}

export async function publishVideo(
  page: Page,
  params: PublishParams,
): Promise<void> {
  validateParams(params)
  const expectedTitle = params.title.slice(0, MAX_TITLE_LENGTH)
  const descriptionWithTags = buildDescriptionWithTags(params.content, params.tags)
  const expectedDescription =
    descriptionWithTags.trim().length > 0
      ? descriptionWithTags.slice(0, MAX_CONTENT_LENGTH)
      : undefined

  await withPrepareRetry(page, "video", async () => {
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

    await fillTextField(page, TITLE_INPUT_SELECTORS, expectedTitle)
    await ensureFieldValue(page, TITLE_INPUT_SELECTORS, expectedTitle, "title")

    if (expectedDescription) {
      await fillTextField(page, DESCRIPTION_INPUT_SELECTORS, expectedDescription)
      await ensureFieldValue(page, DESCRIPTION_INPUT_SELECTORS, expectedDescription, "description")
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
  })

  await submitPublishWhenReady(page, {
    mode: "video",
    expectedTitle,
    expectedDescription,
  })

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
  const expectedTitle = params.title.slice(0, MAX_TITLE_LENGTH)
  const descriptionWithTags = buildDescriptionWithTags(params.content, params.tags)
  const expectedDescription =
    descriptionWithTags.trim().length > 0
      ? descriptionWithTags.slice(0, MAX_CONTENT_LENGTH)
      : undefined

  await withPrepareRetry(page, "image", async () => {
    await page.goto(CREATOR_UPLOAD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await delay(5_000)

    const status = await detectLoginStatus(page)
    if (!status.loggedIn) {
      throw new Error("Not logged in to Douyin creator platform. Use get_login_qrcode first.")
    }

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

    // Upload first image via the initial file input (triggers page navigation)
    const input = (await waitForFirstHandle(
      page,
      IMAGE_FILE_INPUT_SELECTORS,
      30_000,
    )) as ElementHandle<HTMLInputElement> | null
    if (!input) throw new Error("Image file input not found")

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
      input.uploadFile(params.imagePaths[0]),
    ])
    await waitForImageUploadSettled(page, 1)

    // Upload remaining images in one batch via "继续添加" button
    if (params.imagePaths.length > 1) {
      const remainingPaths = params.imagePaths.slice(1)

      const addBtn = await page.$(ADD_MORE_IMAGES_BUTTON_SELECTOR)
      if (!addBtn) {
        throw new Error("继续添加 button not found for batch upload")
      }

      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 5_000 }),
        addBtn.click(),
      ])
      await chooser.accept([...remainingPaths])

      await waitForImageUploadSettled(page, params.imagePaths.length)
      console.error(
        `[douyin] all ${params.imagePaths.length} images uploaded`,
      )
    }

    await selectMusic(page)

    await fillTextField(page, TITLE_INPUT_SELECTORS, expectedTitle)
    await ensureFieldValue(page, TITLE_INPUT_SELECTORS, expectedTitle, "title")

    if (expectedDescription) {
      await fillTextField(page, DESCRIPTION_INPUT_SELECTORS, expectedDescription)
      await ensureFieldValue(page, DESCRIPTION_INPUT_SELECTORS, expectedDescription, "description")
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
  })

  await submitPublishWhenReady(page, {
    mode: "image",
    expectedTitle,
    expectedDescription,
    expectedImageCount: params.imagePaths.length,
  })

  await waitForPublishSuccess(page)
}

async function waitForImageUploaded(page: Page, expectedCount: number): Promise<void> {
  const deadline = Date.now() + IMAGE_UPLOAD_TIMEOUT_MS
  let lastCount = -1
  while (Date.now() < deadline) {
    const count = await countUploadedImages(page)
    if (count !== lastCount) {
      console.error(`[douyin] image upload count: ${count}/${expectedCount}`)
      lastCount = count
    }
    if (count >= expectedCount) return
    await delay(500)
  }
  const processingText = await getProcessingText(page)
  const status = processingText ? ` processing=${processingText}` : ""
  throw new Error(`Image upload timed out waiting for ${expectedCount} uploaded thumbnail(s), current=${lastCount}.${status}`)
}

async function waitForImageUploadSettled(page: Page, expectedCount: number): Promise<void> {
  await waitForImageUploaded(page, expectedCount)

  const deadline = Date.now() + IMAGE_UPLOAD_TIMEOUT_MS
  let stableSince = 0
  let lastStatus = ""

  while (Date.now() < deadline) {
    const [count, processingText] = await Promise.all([
      countUploadedImages(page),
      getProcessingText(page),
    ])

    const ready = count >= expectedCount && !processingText
    const status = `count=${count}/${expectedCount} processing=${processingText ?? "clear"}`
    if (status !== lastStatus) {
      console.error(`[douyin] image upload settle: ${status}`)
      lastStatus = status
    }

    if (ready) {
      if (!stableSince) {
        stableSince = Date.now()
      }
      if (Date.now() - stableSince >= IMAGE_UPLOAD_STABLE_WINDOW_MS) {
        return
      }
    } else {
      stableSince = 0
    }

    await delay(500)
  }

  const processingText = await getProcessingText(page)
  const status = processingText ? ` processing=${processingText}` : ""
  throw new Error(
    `Image upload did not settle for ${expectedCount} uploaded thumbnail(s).${status}`,
  )
}

async function withPrepareRetry(
  page: Page,
  mode: "video" | "image",
  task: () => Promise<void>,
): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= PREPARE_RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        console.error(`[douyin] retrying ${mode} prepare flow (${attempt}/${PREPARE_RETRY_ATTEMPTS})`)
      }
      await task()
      return
    } catch (error) {
      lastError = error
      if (attempt >= PREPARE_RETRY_ATTEMPTS || !shouldRetryPrepare(error)) {
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      console.error(`[douyin] ${mode} prepare failed, will retry: ${message}`)
      await delay(PREPARE_RETRY_DELAY_MS)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function shouldRetryPrepare(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    "upload",
    "上传",
    "timed out",
    "继续添加 button not found",
    "file input not found",
    "Field not found",
    "Failed to confirm",
    "music picker did not open",
  ].some((keyword) => message.includes(keyword))
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

async function ensureFieldValue(
  page: Page,
  selectors: readonly string[],
  expectedValue: string,
  fieldName: string,
  options: { optional?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000)
  let lastValue = ""

  while (Date.now() < deadline) {
    const snapshot = await inspectEditableField(page, selectors)
    if (!snapshot) {
      if (options.optional) {
        return
      }
      await delay(300)
      continue
    }

    lastValue = snapshot.value
    if (fieldMatchesExpectedValue(snapshot.value, expectedValue)) {
      return
    }

    await delay(300)
  }

  const expected = normalizeComparableText(expectedValue)
  const actual = normalizeComparableText(lastValue)
  if (options.optional && !actual) {
    return
  }
  throw new Error(
    `Failed to confirm ${fieldName} field value. expected="${expected}" actual="${actual}"`,
  )
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
  const button = await inspectPublishButton(page)
  if (button?.selector) {
    const handle = await page.$(button.selector)
    if (handle && button.visible && !button.disabled) {
      console.error(`[douyin] clicking publish button via selector: ${button.selector}`)
      await handle.evaluate((element) => {
        ;(element as HTMLElement).click()
      }).catch(() => {})
      await handle.dispose().catch(() => {})
      return true
    }
  }

  const clicked = await clickPublishButtonByText(page, ["发布", "立即发布", "发布作品"])
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

async function clickPublishButtonByText(
  page: Page,
  texts: readonly string[],
): Promise<boolean> {
  return page.evaluate((candidates) => {
    const elements = Array.from(
      document.querySelectorAll("button, [role='button'], a"),
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
      if (!text || !isVisible(element)) continue
      if (
        htmlElement.hasAttribute("disabled") ||
        htmlElement.getAttribute("aria-disabled") === "true"
      ) {
        continue
      }
      if (candidates.some((candidate) => text === candidate)) {
        htmlElement.click()
        return true
      }
    }

    return false
  }, [...texts])
}

async function inspectEditableField(
  page: Page,
  selectors: readonly string[],
): Promise<FieldSnapshot | null> {
  return page.evaluate((candidates) => {
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

    const getValue = (element: Element): string => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return element.value
      }
      return (element as HTMLElement).innerText ?? element.textContent ?? ""
    }

    let firstMatch: FieldSnapshot | null = null
    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector))
      for (const element of elements) {
        const htmlElement = element as HTMLElement
        const snapshot: FieldSnapshot = {
          selector,
          tagName: element.tagName,
          value: getValue(element),
          visible: isVisible(element),
          disabled:
            htmlElement.hasAttribute("disabled") ||
            htmlElement.getAttribute("aria-disabled") === "true",
        }
        if (snapshot.visible) {
          return snapshot
        }
        if (!firstMatch) {
          firstMatch = snapshot
        }
      }
    }

    return firstMatch
  }, [...selectors]).catch(() => null)
}

async function inspectPublishButton(page: Page): Promise<ButtonSnapshot | null> {
  const button = await page.evaluate(
    ({ selectors, texts }) => {
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

      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector))
        for (const element of elements) {
          const htmlElement = element as HTMLElement
          if (!isVisible(element)) continue
          return {
            selector,
            text: htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? "",
            visible: true,
            disabled:
              htmlElement.hasAttribute("disabled") ||
              htmlElement.getAttribute("aria-disabled") === "true",
          }
        }
      }

      const elements = Array.from(document.querySelectorAll("button, [role='button'], a"))
      for (const element of elements) {
        const htmlElement = element as HTMLElement
        const text = htmlElement.innerText?.replace(/\s+/g, " ").trim() ?? ""
        if (!text || !isVisible(element)) continue
        if (!texts.some((candidate) => text === candidate)) continue
        return {
          selector: null,
          text,
          visible: true,
          disabled:
            htmlElement.hasAttribute("disabled") ||
            htmlElement.getAttribute("aria-disabled") === "true",
        }
      }

      return null
    },
    {
      selectors: [...PUBLISH_BUTTON_SELECTORS],
      texts: ["发布", "立即发布", "发布作品"],
    },
  ).catch(() => null)

  return button
}

async function countUploadedImages(page: Page): Promise<number> {
  return page.evaluate((candidates) => {
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

    const urls = new Set<string>()
    const collectUrl = (rawValue: string | null | undefined) => {
      if (!rawValue) {
        return
      }

      const match = rawValue.match(/https?:\/\/[^"')]+creator-media-private\.douyin\.com[^"')]+/i)
      if (match) {
        urls.add(match[0])
      }
    }

    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(element)) {
          continue
        }

        if (element instanceof HTMLImageElement) {
          collectUrl(element.currentSrc || element.src)
          continue
        }

        const htmlElement = element as HTMLElement
        collectUrl(htmlElement.style.backgroundImage)
        collectUrl(window.getComputedStyle(htmlElement).backgroundImage)
      }
    }

    return urls.size
  }, [...IMAGE_UPLOADED_INDICATOR_SELECTORS]).catch(() => 0)
}

async function inspectPublishReadiness(
  page: Page,
  requirements: PublishReadinessRequirements,
): Promise<PublishReadinessSnapshot> {
  const [processingText, titleField, descriptionField, publishButton, imageCount, videoHintText] =
    await Promise.all([
      getProcessingText(page),
      inspectEditableField(page, TITLE_INPUT_SELECTORS),
      inspectEditableField(page, DESCRIPTION_INPUT_SELECTORS),
      inspectPublishButton(page),
      requirements.mode === "image" && requirements.expectedImageCount
        ? countUploadedImages(page)
        : Promise.resolve(0),
      requirements.mode === "video"
        ? findVisibleTextMatch(page, VIDEO_READY_HINT_TEXTS)
        : Promise.resolve(null),
    ])

  const titleReady = Boolean(
    titleField?.visible &&
      !titleField.disabled &&
      fieldMatchesExpectedValue(titleField.value, requirements.expectedTitle),
  )
  const descriptionReady = requirements.expectedDescription
    ? Boolean(
        descriptionField?.visible &&
          !descriptionField.disabled &&
          fieldMatchesExpectedValue(descriptionField.value, requirements.expectedDescription),
      )
    : true
  const uploadReady =
    requirements.mode === "image"
      ? imageCount >= (requirements.expectedImageCount ?? 0)
      : page.url().includes("/content/post/video") && Boolean(videoHintText || titleField?.visible)
  const publishButtonReady = Boolean(
    publishButton?.visible &&
      !publishButton.disabled &&
      publishButton.text.includes("发布"),
  )

  const ready =
    !processingText &&
    uploadReady &&
    titleReady &&
    descriptionReady &&
    publishButtonReady

  return {
    ready,
    processingText,
    titleField,
    descriptionField,
    publishButton,
    imageCount,
    videoHintText,
    status: formatReadinessStatus({
      requirements,
      processingText,
      titleReady,
      descriptionReady,
      publishButtonReady,
      imageCount,
      videoHintText,
    }),
  }
}

function formatReadinessStatus(args: {
  readonly requirements: PublishReadinessRequirements
  readonly processingText: string | null
  readonly titleReady: boolean
  readonly descriptionReady: boolean
  readonly publishButtonReady: boolean
  readonly imageCount: number
  readonly videoHintText: string | null
}): string {
  const parts = [
    args.processingText ? `processing=${args.processingText}` : "processing=clear",
    `title=${args.titleReady ? "ok" : "missing"}`,
    `description=${args.descriptionReady ? "ok" : "missing"}`,
    `button=${args.publishButtonReady ? "ok" : "not-ready"}`,
  ]

  if (args.requirements.mode === "image") {
    parts.push(
      `images=${args.imageCount}/${args.requirements.expectedImageCount ?? 0}`,
    )
  } else {
    parts.push(`video=${args.videoHintText ?? "editor-ready"}`)
  }

  return parts.join(" ")
}

function fieldMatchesExpectedValue(actualValue: string, expectedValue: string): boolean {
  const actual = normalizeComparableText(actualValue)
  const expected = normalizeComparableText(expectedValue)

  if (!expected) {
    return Boolean(actual)
  }
  if (!actual) {
    return false
  }

  if (actual === expected || actual.includes(expected)) {
    return true
  }

  const expectedLines = expectedValue
    .split("\n")
    .map((line) => normalizeComparableText(line))
    .filter(Boolean)
  return expectedLines.every((line) => actual.includes(line))
}

function normalizeComparableText(text: string): string {
  return text
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim()
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
  requirements: PublishReadinessRequirements,
  timeoutMs = SUBMIT_READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastStatus = ""
  let stablePolls = 0

  while (Date.now() < deadline) {
    await dismissBlockingOverlays(page)
    await checkPublishError(page)

    const snapshot = await inspectPublishReadiness(page, requirements)
    if (snapshot.ready) {
      stablePolls += 1
      if (stablePolls >= READINESS_STABLE_POLLS) {
        const published = await clickPublishButton(page)
        if (published) {
          return
        }
        throw new Error(`Publish button became ready but click failed. status=${snapshot.status}`)
      }
    } else {
      stablePolls = 0
    }

    const status = snapshot.status
    if (status !== lastStatus) {
      console.error(`[douyin] waiting before submit: ${status}`)
      lastStatus = status
    }

    await delay(1_500)
  }

  const snapshot = await inspectPublishReadiness(page, requirements).catch(() => null)
  const status = snapshot ? snapshot.status : "readiness snapshot unavailable"
  throw new Error(`Timed out waiting for Douyin publish readiness. status=${status}`)
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

    if (await isOnManagePage(page)) {
      console.error(`[douyin] publish success, manage page detected at: ${currentUrl}`)
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

async function isOnManagePage(page: Page): Promise<boolean> {
  const currentUrl = page.url()
  if (currentUrl.includes("/content/manage")) {
    return true
  }

  const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim()).catch(() => "")
  if (!bodyText) {
    return false
  }

  return MANAGE_PAGE_READY_TEXTS.every((text) => bodyText.includes(text))
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
