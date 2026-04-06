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
  SOURCE_INPUT_SELECTORS,
  TAG_INPUT_SELECTORS,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const VIDEO_UPLOAD_TIMEOUT_MS = 15 * 60_000
const PUBLISH_RESULT_TIMEOUT_MS = 2 * 60_000
const MAX_TITLE_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_TAG_COUNT = 12

export interface PublishParams {
  readonly title: string
  readonly description?: string
  readonly videoPath: string
  readonly tags?: readonly string[]
  readonly category?: string
  readonly copyright?: "original" | "repost"
  readonly source?: string
  readonly submitMode?: "publish" | "draft"
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

  const submitMode = params.submitMode ?? "publish"
  await submitPublish(page, submitMode)
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
  submitMode: "publish" | "draft",
): Promise<void> {
  const buttonTexts =
    submitMode === "draft" ? (["存草稿"] as const) : PUBLISH_BUTTON_TEXTS

  const clickedByText = await clickByTexts(page, buttonTexts)
  if (!clickedByText) {
    const selector = await firstExistingSelector(page, PUBLISH_BUTTON_SELECTORS)
    if (!selector) {
      throw new Error(
        submitMode === "draft"
          ? "Bilibili draft button not found"
          : "Bilibili publish button not found",
      )
    }
    await page.click(selector)
  }

  await delay(1_000)

  const bodyText = await getBodyText(page)
  if (bodyText.includes("确认投稿") || bodyText.includes("确认发布")) {
    await clickByTexts(page, ["确认投稿", "确认发布", "确认", "继续投稿"])
    await delay(500)
  }
}

async function waitForPublishResult(
  page: Page,
  submitMode: "publish" | "draft",
): Promise<void> {
  const deadline = Date.now() + PUBLISH_RESULT_TIMEOUT_MS
  const startUrl = page.url()
  const successTexts =
    submitMode === "draft"
      ? (["保存成功", "草稿保存成功", "已保存草稿", "已存入草稿箱"] as const)
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
      : "Timed out waiting for the Bilibili publish result",
  )
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
