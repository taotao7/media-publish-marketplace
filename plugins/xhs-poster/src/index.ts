import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMcpServer, z } from "./mcp.js"
import type { CallToolResult } from "./mcp.js"
import { launchBrowser } from "./browser.js"
import { deleteCookies, getCookiePath, listAccounts } from "./cookies.js"
import { checkLoginStatus, fetchQrcode, waitForLogin } from "./login.js"
import { publishContent } from "./publish.js"
import { listNotes, listAllNotes, deleteNote, getEditUrl } from "./manage.js"
import { qrcodeToCleanPng } from "./qrcode.js"

const DEFAULT_ACCOUNT = "default"

const accountParam = z
  .string()
  .optional()
  .describe(
    "Account name for multi-account management. Defaults to 'default'. Each account stores its own cookies separately.",
  )

const { server, connect } = createMcpServer({
  name: "mcp-xhs-poster",
  version: "0.1.0",
  description:
    "Xiaohongshu poster — login, publish, edit, delete posts, manage cookies. Supports multiple accounts.",
})

// ── list_accounts ─────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all saved Xiaohongshu accounts that have stored cookies.",
  {},
  async (): Promise<CallToolResult> => {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No accounts found. Use get_login_qrcode to log in with a new account.",
          },
        ],
      }
    }
    return {
      content: [
        {
          type: "text",
          text: `Saved accounts (${accounts.length}):\n${accounts.map((a) => `  - ${a}`).join("\n")}`,
        },
      ],
    }
  },
)

// ── check_login_status ───────────────────────────────────────────────

server.tool(
  "check_login_status",
  "Check whether the current saved cookies represent a valid Xiaohongshu login session.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const { loggedIn } = await checkLoginStatus(managed.page)
      return {
        content: [
          {
            type: "text",
            text: loggedIn
              ? `Account '${acct}' is logged in to Xiaohongshu.`
              : `Account '${acct}' is not logged in. Use get_login_qrcode to authenticate.`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Login check failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── get_login_qrcode ─────────────────────────────────────────────────

server.tool(
  "get_login_qrcode",
  "Get a QR code image for Xiaohongshu login. After returning the QR code, the tool polls in the background for up to 4 minutes waiting for the user to scan. Cookies are saved automatically on success.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const result = await fetchQrcode(managed.page)

      if (result.alreadyLoggedIn) {
        await managed.close()
        return {
          content: [
            {
              type: "text",
              text: `Account '${acct}' is already logged in — no QR code needed.`,
            },
          ],
        }
      }

      // Start background polling — browser stays open until login or timeout
      void (async () => {
        try {
          const success = await waitForLogin(managed.page)
          if (success) {
            await managed.saveCookies()
          }
        } catch {
          // polling failed silently
        } finally {
          await managed.close()
        }
      })()

      const base64Data = result.img!.replace(/^data:image\/\w+;base64,/, "")
      const qrDir = join(homedir(), ".media-mcp")
      mkdirSync(qrDir, { recursive: true })
      const qrPath = join(qrDir, `qrcode-${acct}.png`)
      writeFileSync(qrPath, Buffer.from(base64Data, "base64"))

      let cleanBase64: string | undefined
      try {
        cleanBase64 = await qrcodeToCleanPng(base64Data)
      } catch {
        // fall back to original image
      }

      if (cleanBase64) {
        writeFileSync(qrPath, Buffer.from(cleanBase64, "base64"))
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `QR code saved to: ${qrPath}`,
              `Account: ${acct}`,
              `Please open this file with an image viewer (e.g. run: open "${qrPath}") and scan it with the Xiaohongshu app to log in.`,
              `Waiting up to 4 minutes for login…`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      await managed.close()
      return errorResult(`QR code fetch failed: ${String(error)}`)
    }
  },
)

// ── list_notes ───────────────────────────────────────────────────────

server.tool(
  "list_notes",
  "List the default page of notes shown in the Xiaohongshu creator note manager (one page at a time). Use list_all_notes to retrieve every note across all pages.",
  {
    account: accountParam,
    page: z
      .number()
      .optional()
      .describe("Page number (0-indexed). Defaults to 0."),
  },
  async ({ account, page: pageNum }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const notes = await listNotes(managed.page, pageNum ?? 0)
      await managed.saveCookies()

      if (notes.length === 0) {
        return {
          content: [{ type: "text", text: `No notes found (account: ${acct}).` }],
        }
      }

      const lines = notes.map(
        (n, i) =>
          `${i + 1}. [${n.id}] ${n.title}\n` +
          `   ${n.time} | views: ${n.views} likes: ${n.likes} collects: ${n.collects} comments: ${n.comments} shares: ${n.shares}` +
          (n.sticky ? " [置顶]" : "") +
          (n.scheduledAt ? `\n   [定时发布: ${n.scheduledAt}]` : ""),
      )

      return {
        content: [
          {
            type: "text",
            text: `Notes for account '${acct}' (${notes.length}):\n\n${lines.join("\n\n")}`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`List notes failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── list_all_notes ──────────────────────────────────────────────────

server.tool(
  "list_all_notes",
  "List ALL notes from the current Xiaohongshu account, automatically paginating through all pages. Returns every note's ID, title, stats, and scheduled publish time if applicable.",
  {
    account: accountParam,
  },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      const notes = await listAllNotes(managed.page)
      await managed.saveCookies()

      if (notes.length === 0) {
        return {
          content: [{ type: "text", text: `No notes found (account: ${acct}).` }],
        }
      }

      const lines = notes.map(
        (n, i) =>
          `${i + 1}. [${n.id}] ${n.title}\n` +
          `   ${n.time} | views: ${n.views} likes: ${n.likes} collects: ${n.collects} comments: ${n.comments} shares: ${n.shares}` +
          (n.sticky ? " [置顶]" : "") +
          (n.scheduledAt ? `\n   [定时发布: ${n.scheduledAt}]` : ""),
      )

      return {
        content: [
          {
            type: "text",
            text: `All notes for account '${acct}' (${notes.length} total):\n\n${lines.join("\n\n")}`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`List all notes failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── delete_note ──────────────────────────────────────────────────────

server.tool(
  "delete_note",
  "Delete a published note from Xiaohongshu. Use list_notes to get the note ID first. This action is irreversible.",
  {
    account: accountParam,
    note_id: z.string().describe("The note ID to delete (from list_notes)"),
  },
  async ({ account, note_id }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      await deleteNote(managed.page, note_id)
      await managed.saveCookies()
      return {
        content: [
          {
            type: "text",
            text: `Note ${note_id} deleted successfully (account: ${acct}).`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Delete note failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── edit_note ────────────────────────────────────────────────────────

server.tool(
  "edit_note",
  "Edit an existing note on Xiaohongshu. Navigates to the edit page and updates the specified fields. Only provided fields will be updated; omitted fields keep their current values.",
  {
    account: accountParam,
    note_id: z.string().describe("The note ID to edit (from list_notes)"),
    title: z.string().optional().describe("New title (leave empty to keep current)"),
    content: z.string().optional().describe("New body text (leave empty to keep current)"),
    images: z
      .array(z.string())
      .optional()
      .describe("New image paths. WARNING: replaces all existing images."),
    tags: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("New hashtags (max 10). Appended after content."),
  },
  async ({ account, note_id, title, content, images, tags }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      await editNote(managed.page, note_id, { title, content, images, tags })
      await managed.saveCookies()
      return {
        content: [
          {
            type: "text",
            text: `Note ${note_id} updated successfully (account: ${acct}).`,
          },
        ],
      }
    } catch (error) {
      console.error("[edit] ERROR — keeping browser open 30s for inspection")
      await new Promise((r) => setTimeout(r, 30_000))
      return errorResult(`Edit note failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── publish_content ──────────────────────────────────────────────────

server.tool(
  "publish_content",
  "Publish an image post to Xiaohongshu. Requires prior login (cookies must exist). Uploads local image files, fills in title/content/tags, and optionally schedules the post.",
  {
    account: accountParam,
    title: z.string().describe("Post title"),
    content: z.string().describe("Post body text"),
    images: z
      .array(z.string())
      .min(1)
      .describe("Absolute paths to local image files"),
    tags: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("Hashtags to attach (max 10)"),
    schedule_at: z
      .string()
      .optional()
      .describe(
        "ISO 8601 datetime for scheduled publishing (1 hour – 14 days from now)",
      ),
    attachments: z
      .array(z.string())
      .optional()
      .describe(
        "Absolute paths to local attachment files (e.g. prompt.txt)",
      ),
  },
  async ({
    account,
    title,
    content,
    images,
    tags,
    schedule_at,
    attachments,
  }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    const managed = await launchBrowser(acct)
    try {
      await publishContent(managed.page, {
        title,
        content,
        images,
        tags,
        scheduleAt: schedule_at,
        attachments,
      })
      await managed.saveCookies()
      return {
        content: [
          {
            type: "text",
            text: schedule_at
              ? `Post scheduled for ${schedule_at} (account: ${acct}).`
              : `Post published successfully (account: ${acct}).`,
          },
        ],
      }
    } catch (error) {
      console.error(
        "[publish] ERROR — keeping browser open 30s for inspection",
      )
      await new Promise((r) => setTimeout(r, 30_000))
      return errorResult(`Publish failed: ${String(error)}`)
    } finally {
      await managed.close()
    }
  },
)

// ── delete_cookies ───────────────────────────────────────────────────

server.tool(
  "delete_cookies",
  "Delete saved Xiaohongshu cookies to reset login state for a specific account.",
  { account: accountParam },
  async ({ account }): Promise<CallToolResult> => {
    const acct = account || DEFAULT_ACCOUNT
    try {
      const path = getCookiePath(acct)
      await deleteCookies(acct)
      return {
        content: [
          {
            type: "text",
            text: `Cookies deleted for account '${acct}': ${path}`,
          },
        ],
      }
    } catch (error) {
      return errorResult(`Delete cookies failed: ${String(error)}`)
    }
  },
)

// ── edit note implementation ────────────────────────────────────────

import type { Page } from "puppeteer"
import type { ElementHandle } from "puppeteer"
import {
  UPLOAD_CONTENT_AREA,
  TITLE_INPUT,
  TITLE_MAX_SUFFIX,
  CONTENT_EDITOR,
  CONTENT_LENGTH_ERROR,
  TOPIC_CONTAINER,
  TOPIC_ITEM,
  PUBLISH_BTN,
  POPOVER,
  UPLOAD_INPUT,
  IMG_PREVIEW,
} from "./selectors.js"

interface EditParams {
  title?: string
  content?: string
  images?: string[]
  tags?: string[]
}

async function editNote(
  page: Page,
  noteId: string,
  params: EditParams,
): Promise<void> {
  const editUrl = getEditUrl(noteId)
  console.error(`[edit] navigating to ${editUrl}`)
  await page.goto(editUrl, { waitUntil: "networkidle2", timeout: 30_000 })
  await delay(5000)

  if (page.url().includes("login")) {
    throw new Error("Not logged in to creator platform.")
  }

  // Wait for the page to load
  console.error("[edit] waiting for publish page to load...")
  await page.waitForSelector(TITLE_INPUT, { timeout: 15_000 })

  // ── Replace images ──────────────────────────────────────────────
  // XHS requires ≥1 image AND has an upper limit, so:
  //   1. Delete all old images except the last one
  //   2. Upload all new images
  //   3. Delete the remaining old image
  if (params.images && params.images.length > 0) {
    console.error("[edit] replacing images...")
    const oldImageCount = await page.$$eval(IMG_PREVIEW, (els) => els.length)
    console.error(`[edit] existing images: ${oldImageCount}`)

    // Step 1: delete old images, keep the last one
    if (oldImageCount > 1) {
      await editDeleteFirstNImages(page, oldImageCount - 1)
    }

    // Step 2: upload all new images (now only 1 old image remains)
    const remainingBefore = await page.$$eval(IMG_PREVIEW, (els) => els.length)
    await editUploadImages(page, params.images, remainingBefore)

    // Step 3: delete the last old image (it's the first in the list)
    console.error("[edit] deleting the last old image...")
    await editDeleteFirstNImages(page, 1)
  }

  // ── Update title: clear then retype ─────────────────────────────
  if (params.title) {
    console.error("[edit] updating title...")
    await editClearAndFillTitle(page, params.title)
  }

  // ── Update content: clear then retype ───────────────────────────
  if (params.content) {
    console.error("[edit] updating content...")
    await editClearAndFillContent(page, params.content)
  }

  // ── Add tags (appended after content) ───────────────────────────
  if (params.tags && params.tags.length > 0) {
    console.error("[edit] adding tags...")
    await editFillTags(page, params.tags)
  }

  // ── Click publish/save button ───────────────────────────────────
  console.error("[edit] clicking save/publish button...")
  await dismissPopover(page)

  const btn = await page.$(PUBLISH_BTN)
  if (btn) {
    await btn.evaluate((el) => (el as HTMLElement).click())
  } else {
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button")
      for (const b of buttons) {
        const text = b.textContent || ""
        if ((text.includes("发布") || text.includes("保存")) && !b.disabled) {
          b.click()
          return true
        }
      }
      return false
    })
    if (!clicked) throw new Error("Publish/save button not found")
  }

  await delay(3000)
  console.error("[edit] done!")
}

// ── edit helpers ─────────────────────────────────────────────────────

async function editUploadImages(
  page: Page,
  images: string[],
  oldImageCount: number,
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    // Find any file input that accepts images
    let input = await page.$('input[type="file"][accept*="image"]') as ElementHandle<HTMLInputElement> | null
    if (!input) {
      input = await page.$('input[type="file"][accept*="jpg"]') as ElementHandle<HTMLInputElement> | null
    }
    if (!input) {
      input = await page.$('input[type="file"]') as ElementHandle<HTMLInputElement> | null
    }
    if (!input) {
      // Maybe we need to click the upload area first
      const uploadArea = await page.$(".upload-input")
      if (uploadArea) {
        await uploadArea.click()
        await delay(1000)
        input = await page.$('input[type="file"]') as ElementHandle<HTMLInputElement> | null
      }
    }
    if (!input) throw new Error(`Upload file input not found (image ${i + 1})`)

    console.error(`[edit] uploading image ${i + 1}/${images.length}: ${images[i]}`)
    await input.uploadFile(images[i])

    // Wait for preview count to reach expected (old + newly uploaded)
    const expectedCount = oldImageCount + i + 1
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const currentCount = await page.$$eval(IMG_PREVIEW, (els) => els.length)
      if (currentCount >= expectedCount) break
      await delay(500)
    }
    console.error(`[edit] image ${i + 1} uploaded`)
  }

  console.error(`[edit] all ${images.length} new images uploaded`)
}

async function editDeleteFirstNImages(page: Page, n: number): Promise<void> {
  console.error(`[edit] deleting first ${n} images...`)

  for (let i = 0; i < n; i++) {
    console.error(`[edit] deleting image ${i + 1}/${n}...`)

    // Always delete the first preview element (old images are at the front)
    const deleted = await page.evaluate((previewSel) => {
      const firstPr = document.querySelector(previewSel) as HTMLElement | null
      if (!firstPr) return false

      // Find the close button inside
      const closeBtn = firstPr.querySelector(".close-btn") as HTMLElement | null
      if (closeBtn) {
        closeBtn.style.cssText =
          "display:flex !important; opacity:1 !important; visibility:visible !important; pointer-events:auto !important;"
        closeBtn.click()
        return true
      }

      // Fallback: try any element that looks like a close/delete button
      const anyClose = firstPr.querySelector(
        '[class*="close"], [class*="delete"], [class*="remove"], .icon-close, .icon-delete'
      ) as HTMLElement | null
      if (anyClose) {
        anyClose.style.cssText =
          "display:flex !important; opacity:1 !important; visibility:visible !important; pointer-events:auto !important;"
        anyClose.click()
        return true
      }

      return false
    }, IMG_PREVIEW)

    if (!deleted) {
      // Fallback: hover to reveal close button, then click
      const firstPr = await page.$(IMG_PREVIEW)
      if (!firstPr) break

      const box = await firstPr.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await delay(800)

        const hoverDeleted = await page.evaluate((previewSel) => {
          const el = document.querySelector(previewSel) as HTMLElement | null
          if (!el) return false
          const btn = el.querySelector(".close-btn") as HTMLElement | null
          if (btn) {
            btn.click()
            return true
          }
          return false
        }, IMG_PREVIEW)

        if (!hoverDeleted) {
          console.error(`[edit] WARNING: could not delete image ${i + 1}, skipping`)
          continue
        }
      } else {
        console.error(`[edit] WARNING: could not get bounding box for image ${i + 1}, skipping`)
        continue
      }
    }

    await delay(1500)
    const remaining = await page.$$eval(IMG_PREVIEW, (els) => els.length)
    console.error(`[edit] images remaining: ${remaining}`)
  }

  const finalCount = await page.$$eval(IMG_PREVIEW, (els) => els.length)
  console.error(`[edit] deletion done, remaining: ${finalCount}`)
}

async function editClearAndFillTitle(page: Page, title: string): Promise<void> {
  const titleInput = await page.$(TITLE_INPUT)
  if (!titleInput) throw new Error("Title input not found")

  // Clear the title completely using JS
  await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLInputElement | null
    if (input) {
      input.focus()
      input.value = ""
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }, TITLE_INPUT)
  await delay(300)

  // Also use keyboard to make sure it's cleared
  await titleInput.click()
  await page.keyboard.down("Meta")
  await page.keyboard.press("a")
  await page.keyboard.up("Meta")
  await delay(100)
  await page.keyboard.press("Backspace")
  await delay(300)

  // Type the new title
  await titleInput.type(title, { delay: 30 })
  await delay(500)

  const tooLong = await page.$(TITLE_MAX_SUFFIX)
  if (tooLong) {
    throw new Error("Title exceeds maximum length")
  }
}

async function editClearAndFillContent(page: Page, content: string): Promise<void> {
  const editor = await page.$(CONTENT_EDITOR)
  if (!editor) throw new Error("Content editor not found")

  // Strategy: clear all content in the editor using innerHTML, then type new content
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (el) {
      el.innerHTML = "<p><br></p>"
      el.focus()
    }
  }, CONTENT_EDITOR)
  await delay(500)

  // Click to make sure cursor is in the editor
  await editor.click()
  await delay(200)

  // Type the new content
  await page.keyboard.type(content, { delay: 10 })
  await delay(500)

  const tooLong = await page.$(CONTENT_LENGTH_ERROR)
  if (tooLong) {
    throw new Error("Content exceeds maximum length")
  }
}

async function editFillTags(page: Page, tags: string[]): Promise<void> {
  const editor = await page.$(CONTENT_EDITOR)
  if (!editor) throw new Error("Content editor not found for tags")

  // Move cursor to end of content
  await editor.click()
  await page.keyboard.down("Meta")
  await page.keyboard.press("End")
  await page.keyboard.up("Meta")
  await delay(100)
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowDown")
  }
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  await delay(300)

  for (const tag of tags.slice(0, 10)) {
    await page.keyboard.type(`#${tag}`, { delay: 30 })
    await delay(1000)

    try {
      await page.waitForSelector(`${TOPIC_CONTAINER} ${TOPIC_ITEM}`, {
        timeout: 5000,
      })
      const item = await page.$(`${TOPIC_CONTAINER} ${TOPIC_ITEM}`)
      if (item) {
        await item.click()
      }
    } catch {
      // Topic suggestion didn't appear
    }
    await delay(500)
  }
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

// ── helpers ──────────────────────────────────────────────────────────

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

process.on("SIGINT", () => {
  process.exit(0)
})

await connect()
