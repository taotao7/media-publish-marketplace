import type { Page } from "puppeteer"
import { NOTE_DELETE_BTN } from "./selectors.js"

const NOTE_MANAGER_URL = "https://creator.xiaohongshu.com/new/note-manager"
const UPDATE_URL = "https://creator.xiaohongshu.com/publish/update"
const NOTE_API_PATTERN = "/creator/note/user/posted"
const NOTE_API_V2 = "/api/galaxy/v2/creator/note/user/posted"

export interface NoteInfo {
  readonly id: string
  readonly title: string
  readonly time: string
  readonly type: string
  readonly views: number
  readonly likes: number
  readonly comments: number
  readonly collects: number
  readonly shares: number
  readonly sticky: boolean
  readonly coverUrl: string
}

// ── list notes ──────────────────────────────────────────────────────

export async function listNotes(
  page: Page,
  pageNum: number = 0,
): Promise<NoteInfo[]> {
  // Set up response interception before navigation
  const apiPromise = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Note list API timeout")), 20_000)

    page.on("response", async (resp) => {
      if (resp.url().includes(NOTE_API_PATTERN)) {
        try {
          const body = await resp.json()
          clearTimeout(timeout)
          resolve(body)
        } catch {}
      }
    })
  })

  await page.goto(NOTE_MANAGER_URL, { waitUntil: "networkidle2", timeout: 30_000 })
  await delay(3000)

  assertNotLogin(page)

  const response = await apiPromise

  if (!response?.data?.notes) {
    return []
  }

  return mapNotes(response.data.notes)
}

// ── list all notes (with pagination) ────────────────────────────────

export async function listAllNotes(page: Page): Promise<NoteInfo[]> {
  const allNotes: NoteInfo[] = []

  // Intercept ALL matching API responses (across pages)
  const collectedResponses: any[] = []
  const responseHandler = async (resp: any) => {
    if (resp.url().includes(NOTE_API_V2)) {
      try {
        const body = await resp.json()
        collectedResponses.push(body)
      } catch {}
    }
  }
  page.on("response", responseHandler)

  // Navigate to note manager — this triggers the first API call (page=0)
  await page.goto(NOTE_MANAGER_URL, { waitUntil: "networkidle2", timeout: 30_000 })
  await delay(3000)
  assertNotLogin(page)

  // Wait a bit for the first response to be captured
  await delay(2000)

  if (collectedResponses.length === 0) {
    page.off("response", responseHandler)
    return []
  }

  const firstResponse = collectedResponses[0]
  if (firstResponse?.data?.notes) {
    allNotes.push(...mapNotes(firstResponse.data.notes))
  }

  let nextPage = firstResponse?.data?.page ?? -1

  // Paginate: scroll the .content container to trigger infinite scroll loading
  while (nextPage !== -1) {
    const prevCount = collectedResponses.length

    // Scroll the .content container to its bottom
    await page.evaluate(() => {
      const container = document.querySelector(".content")
      if (container) {
        container.scrollTo(0, container.scrollHeight)
      }
    })

    // Wait for the next API response
    const deadline = Date.now() + 15_000
    while (collectedResponses.length === prevCount && Date.now() < deadline) {
      await delay(500)
    }

    if (collectedResponses.length === prevCount) {
      // No new response received, stop
      break
    }

    const latestResponse = collectedResponses[collectedResponses.length - 1]
    if (latestResponse?.data?.notes) {
      allNotes.push(...mapNotes(latestResponse.data.notes))
    }
    nextPage = latestResponse?.data?.page ?? -1
  }

  page.off("response", responseHandler)
  return allNotes
}

function mapNotes(notes: any[]): NoteInfo[] {
  return notes.map((note: any) => ({
    id: note.id,
    title: note.display_title || "",
    time: note.time || "",
    type: note.type || "normal",
    views: note.view_count || 0,
    likes: note.likes || 0,
    comments: note.comments_count || 0,
    collects: note.collected_count || 0,
    shares: note.shared_count || 0,
    sticky: note.sticky || false,
    coverUrl: note.images_list?.[0]?.url || "",
  }))
}

// ── delete note ─────────────────────────────────────────────────────

export async function deleteNote(
  page: Page,
  noteId: string,
): Promise<void> {
  await page.goto(NOTE_MANAGER_URL, { waitUntil: "networkidle2", timeout: 30_000 })
  await delay(3000)

  assertNotLogin(page)

  // Find the note item with matching ID and click its delete button
  const deleted = await page.evaluate(
    (targetId, delBtnSel) => {
      const notes = document.querySelectorAll(".d-tabs-pane .note")
      for (const note of notes) {
        const impression = note.getAttribute("data-impression") || ""
        if (impression.includes(targetId)) {
          const delBtn = note.querySelector(delBtnSel) as HTMLElement | null
          if (delBtn) {
            delBtn.click()
            return true
          }
        }
      }
      return false
    },
    noteId,
    NOTE_DELETE_BTN,
  )

  if (!deleted) {
    throw new Error(`Note not found: ${noteId}`)
  }

  await delay(1000)

  // Handle confirmation dialog
  const confirmed = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button")
    for (const btn of buttons) {
      const text = (btn.textContent || "").trim()
      if (text === "确认" || text === "确定" || text === "删除") {
        const modal = btn.closest("[class*='modal'], [class*='dialog'], [role='dialog']")
        if (modal) {
          btn.click()
          return true
        }
      }
    }
    // Fallback
    const primaryBtns = document.querySelectorAll(
      ".d-modal button.d-button--theme-primary, .el-dialog button.el-button--primary"
    )
    for (const btn of primaryBtns) {
      ;(btn as HTMLElement).click()
      return true
    }
    return false
  })

  if (!confirmed) {
    throw new Error("Delete confirmation dialog not found")
  }

  await delay(2000)
  console.error(`[manage] note ${noteId} deleted`)
}

// ── get edit URL ────────────────────────────────────────────────────

export function getEditUrl(noteId: string, noteType: string = "normal"): string {
  return `${UPDATE_URL}?id=${noteId}&noteType=${noteType}`
}

// ── helpers ─────────────────────────────────────────────────────────

function assertNotLogin(page: Page): void {
  if (page.url().includes("login")) {
    throw new Error("Not logged in to creator platform. Use get_login_qrcode first.")
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
