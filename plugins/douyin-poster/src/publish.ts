import { existsSync } from "node:fs"
import type { ElementHandle, Page } from "puppeteer"
import { detectLoginStatus } from "./login.js"
import {
  CREATOR_UPLOAD_URL,
  DESCRIPTION_INPUT_SELECTORS,
  FILE_INPUT_SELECTORS,
  PUBLISH_BUTTON_SELECTORS,
  PROGRESS_SELECTORS,
  TAG_INPUT_SELECTORS,
  TITLE_INPUT_SELECTORS,
} from "./selectors.js"

const VIDEO_UPLOAD_TIMEOUT_MS = 300_000
const MAX_TITLE_LENGTH = 60
const MAX_CONTENT_LENGTH = 1_000

export interface PublishParams {
  readonly title: string
  readonly content?: string
  readonly videoPath: string
  readonly tags?: readonly string[]
  readonly visibility?: "public" | "private"
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

  if (params.content && params.content.trim()) {
    await fillTextField(
      page,
      DESCRIPTION_INPUT_SELECTORS,
      params.content.slice(0, MAX_CONTENT_LENGTH),
      { optional: true },
    )
  }

  if ((params.tags?.length ?? 0) > 0) {
    await addTags(page, params.tags ?? [])
  }

  if (params.visibility === "private") {
    const privateSet = await clickByTexts(page, ["私密", "仅自己可见", "私密仅自己可见"])
    if (!privateSet) {
      console.error("[douyin] private visibility option not found, keeping default visibility")
    }
    await delay(800)
  }

  const published = await clickPublishButton(page)
  if (!published) {
    throw new Error("Douyin publish button not found")
  }

  await delay(10_000)
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

  while (Date.now() < deadline) {
    const titleSelector = await firstExistingSelector(page, TITLE_INPUT_SELECTORS)
    const descriptionSelector = await firstExistingSelector(
      page,
      DESCRIPTION_INPUT_SELECTORS,
    )

    if (titleSelector || descriptionSelector) {
      return
    }

    const progressText = await getProgressText(page)
    if (progressText) {
      console.error(`[douyin] upload progress: ${progressText}`)
    }

    await delay(2_000)
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

async function addTags(page: Page, tags: readonly string[]): Promise<void> {
  const cleanTags = tags
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 5)

  if (cleanTags.length === 0) {
    return
  }

  const tagSelector = await firstExistingSelector(page, TAG_INPUT_SELECTORS)
  if (tagSelector) {
    for (const tag of cleanTags) {
      await fillTextField(page, [tagSelector], tag, { optional: true })
      await page.keyboard.press("Enter").catch(() => {})
      await delay(600)
    }
    return
  }

  const descriptionSelector = await firstExistingSelector(
    page,
    DESCRIPTION_INPUT_SELECTORS,
  )
  if (!descriptionSelector) {
    return
  }

  await page.focus(descriptionSelector).catch(() => {})
  await page.keyboard.press("End").catch(() => {})
  await page.keyboard.type(`\n${cleanTags.map((tag) => `#${tag}`).join(" ")}`, {
    delay: 20,
  })
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
      await handle?.click().catch(() => {})
      return true
    }
  }

  return clickByTexts(page, ["发布", "立即发布", "发布作品"])
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
      if (candidates.some((candidate) => text === candidate || text.includes(candidate))) {
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
      if (text) return text
    }
  }

  return null
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
