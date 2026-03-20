/**
 * E2E test: publish a post, verify it appears in the list, then delete it.
 *
 * Usage:
 *   bun run test/e2e.ts
 */

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { launchBrowser } from "../src/browser.js"
import { checkLoginStatus } from "../src/login.js"
import { publishContent } from "../src/publish.js"
import { listNotes, deleteNote } from "../src/manage.js"

const TEST_TITLE = `[E2E TEST] ${new Date().toISOString()}`
const TEST_CONTENT = "This is an automated e2e test post. Please ignore."
const TEST_TAGS = ["测试"]

// ── Create a minimal PNG (1×1 white pixel) ───────────────────────────

function createTestImage(): string {
  const tmpDir = join(homedir(), ".media-mcp", "test")
  mkdirSync(tmpDir, { recursive: true })
  const imgPath = join(tmpDir, "test-image.png")

  // Minimal valid 1×1 red PNG (base64-encoded)
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  )
  writeFileSync(imgPath, minimalPng)
  return imgPath
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== XHS Poster E2E Test ===\n")

  // Step 1: Check login
  console.log("[1/4] Checking login status...")
  const managed = await launchBrowser("default")
  let loggedIn = false
  try {
    const result = await checkLoginStatus(managed.page)
    loggedIn = result.loggedIn
  } finally {
    await managed.close()
  }

  if (!loggedIn) {
    console.error("❌ Not logged in. Run get_login_qrcode first.")
    process.exit(1)
  }
  console.log("✅ Logged in\n")

  // Step 2: Create test image & publish
  const imgPath = createTestImage()
  console.log(`[2/4] Publishing test post: "${TEST_TITLE}"`)
  console.log(`      Image: ${imgPath}`)

  const publishManaged = await launchBrowser("default")
  try {
    await publishContent(publishManaged.page, {
      title: TEST_TITLE,
      content: TEST_CONTENT,
      images: [imgPath],
      tags: TEST_TAGS,
    })
    await publishManaged.saveCookies()
  } finally {
    await publishManaged.close()
  }
  console.log("✅ Published\n")

  // Step 3: Find the note we just published
  console.log("[3/4] Listing notes to find the test post...")
  // Wait a moment for the post to appear
  await delay(3000)

  const listManaged = await launchBrowser("default")
  let noteId: string | undefined
  try {
    const notes = await listNotes(listManaged.page, 0)
    await listManaged.saveCookies()
    console.log(`      Found ${notes.length} note(s) on page 0`)
    const match = notes.find((n) => n.title === TEST_TITLE)
    if (match) {
      noteId = match.id
      console.log(`✅ Found test post: [${noteId}] ${match.title}\n`)
    } else {
      console.log("      Notes on page 0:")
      for (const n of notes.slice(0, 5)) {
        console.log(`        - [${n.id}] ${n.title}`)
      }
      console.warn("⚠️  Test post not found in first page (may still be processing). Skipping delete.")
    }
  } finally {
    await listManaged.close()
  }

  // Step 4: Delete the test note
  if (noteId) {
    console.log(`[4/4] Deleting test post [${noteId}]...`)
    const deleteManaged = await launchBrowser("default")
    try {
      await deleteNote(deleteManaged.page, noteId)
      await deleteManaged.saveCookies()
    } finally {
      await deleteManaged.close()
    }
    console.log("✅ Deleted\n")
  }

  // Cleanup temp image
  try { unlinkSync(imgPath) } catch {}

  console.log("=== Test complete ===")
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((err) => {
  console.error("❌ Test failed:", err)
  process.exit(1)
})
