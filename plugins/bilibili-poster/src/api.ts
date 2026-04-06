import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs"
import { basename, extname } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  BilibiliClientCredentials,
  BilibiliOAuthConfig,
} from "./config.js"
import { buildSignedHeaders } from "./signature.js"

const PART_SIZE = 8 * 1024 * 1024
const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024
const MAX_COVER_SIZE = 5 * 1024 * 1024

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".flv": "video/x-flv",
}

interface OpenApiEnvelope<T> {
  readonly code: number
  readonly message: string
  readonly request_id?: string
  readonly data: T
}

export interface TokenResponseData {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_in: number
  readonly scopes?: readonly string[]
}

export interface CategoryNode {
  readonly id: number
  readonly parent: number
  readonly name: string
  readonly description: string
  readonly children?: readonly CategoryNode[]
}

export interface UploadInitResult {
  readonly upload_token: string
}

export interface CoverUploadResult {
  readonly url: string
}

export interface SubmitVideoResult {
  readonly resource_id: string
}

export interface PublishVideoInput {
  readonly accessToken: string
  readonly title: string
  readonly videoPath: string
  readonly tid: number
  readonly tags: readonly string[]
  readonly description?: string
  readonly coverPath?: string
  readonly coverUrl?: string
  readonly noReprint?: 0 | 1
  readonly copyright: 1 | 2
  readonly source?: string
  readonly topicId?: number
  readonly missionId?: number
}

export interface PublishVideoOutput {
  readonly resourceId: string
  readonly uploadToken: string
  readonly coverUrl?: string
  readonly chunkCount: number
}

export function buildPcOauthUrl(
  config: BilibiliOAuthConfig,
  state: string,
): string {
  const url = new URL(config.authBaseUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("gourl", config.redirectUri)
  url.searchParams.set("state", state)
  return url.toString()
}

export async function exchangeCodeForToken(
  config: BilibiliClientCredentials,
  code: string,
): Promise<TokenResponseData> {
  const url = new URL("https://api.bilibili.com/x/account-oauth2/v1/token")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("client_secret", config.clientSecret)
  url.searchParams.set("grant_type", "authorization_code")
  url.searchParams.set("code", code)

  return requestJsonEnvelope<TokenResponseData>(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })
}

export async function refreshAccessToken(
  config: BilibiliClientCredentials,
  refreshToken: string,
): Promise<TokenResponseData> {
  const url = new URL(
    "https://api.bilibili.com/x/account-oauth2/v1/refresh_token",
  )
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("client_secret", config.clientSecret)
  url.searchParams.set("grant_type", "refresh_token")
  url.searchParams.set("refresh_token", refreshToken)

  return requestJsonEnvelope<TokenResponseData>(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })
}

export async function listCategories(
  config: BilibiliClientCredentials,
  accessToken: string,
): Promise<readonly CategoryNode[]> {
  return requestSignedJson<readonly CategoryNode[]>(config, accessToken, {
    method: "GET",
    url: "https://member.bilibili.com/arcopen/fn/archive/type/list",
  })
}

export async function uploadCover(
  config: BilibiliClientCredentials,
  accessToken: string,
  filePath: string,
): Promise<string> {
  const fileStat = statSync(filePath)
  if (fileStat.size > MAX_COVER_SIZE) {
    throw new Error("Cover file must be 5MB or smaller.")
  }

  const { body, contentType } = createMultipartFileBody("file", filePath)
  const headers = buildSignedHeaders({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken,
    contentType,
    // Signature doc says multipart requests hash only non-file fields.
    bodyTextForMd5: "",
  })

  const data = await requestJsonEnvelope<CoverUploadResult>(
    "https://member.bilibili.com/arcopen/fn/archive/cover/upload",
    {
      method: "POST",
      headers,
      body: Buffer.from(body),
    },
  )

  return data.url
}

export async function publishVideo(
  config: BilibiliClientCredentials,
  input: PublishVideoInput,
): Promise<PublishVideoOutput> {
  const videoSize = statSync(input.videoPath).size
  if (videoSize > MAX_VIDEO_SIZE) {
    throw new Error("Video file must be 4GB or smaller.")
  }

  const uploadToken = await initUpload(
    config,
    input.accessToken,
    basename(input.videoPath),
    // Inference from the docs: multipart upload works for all sizes and is
    // required above 100MB, so the plugin uses that flow consistently.
    "0",
  )

  // Upload video chunks and cover image concurrently — they are independent.
  const coverPromise = input.coverUrl
    ? Promise.resolve(input.coverUrl)
    : input.coverPath
      ? uploadCover(config, input.accessToken, input.coverPath)
      : Promise.resolve(undefined)

  const [chunkCount] = await Promise.all([
    uploadVideoParts(uploadToken, input.videoPath, videoSize),
    coverPromise,
  ])
  await completeUpload(uploadToken)

  const coverUrl = await coverPromise

  const body = compactObject({
    title: input.title,
    cover: coverUrl,
    tid: input.tid,
    no_reprint: input.noReprint ?? 0,
    desc: input.description,
    tag: input.tags.map((tag) => tag.trim()).filter(Boolean).join(","),
    copyright: input.copyright,
    source: input.source,
    topic_id: input.topicId,
    mission_id: input.missionId,
  })

  if (!body.tag) {
    throw new Error("At least one non-empty tag is required.")
  }
  if (input.copyright === 2 && !input.source) {
    throw new Error("source is required when copyright is set to reprint.")
  }

  const result = await requestSignedJson<SubmitVideoResult>(
    config,
    input.accessToken,
    {
      method: "POST",
      url: "https://member.bilibili.com/arcopen/fn/archive/add-by-utoken",
      query: { upload_token: uploadToken },
      body,
    },
  )

  return {
    resourceId: result.resource_id,
    uploadToken,
    coverUrl,
    chunkCount,
  }
}

async function initUpload(
  config: BilibiliClientCredentials,
  accessToken: string,
  name: string,
  utype: "0" | "1",
): Promise<string> {
  const payload = {
    name,
    utype,
  }

  const result = await requestSignedJson<UploadInitResult>(config, accessToken, {
    method: "POST",
    url: "https://member.bilibili.com/arcopen/fn/archive/video/init",
    body: payload,
  })

  return result.upload_token
}

async function uploadVideoParts(
  uploadToken: string,
  filePath: string,
  fileSize: number,
): Promise<number> {
  const fd = openSync(filePath, "r")
  let partNumber = 1
  let offset = 0

  try {
    while (offset < fileSize) {
      const expectedSize = Math.min(PART_SIZE, fileSize - offset)
      const chunkBuffer = Buffer.allocUnsafe(expectedSize)
      const bytesRead = readSync(fd, chunkBuffer, 0, expectedSize, offset)
      if (bytesRead <= 0) {
        throw new Error("Unexpected EOF while reading the video file.")
      }

      await uploadPart(
        uploadToken,
        partNumber,
        chunkBuffer.subarray(0, bytesRead),
      )

      offset += bytesRead
      partNumber += 1
    }
  } finally {
    closeSync(fd)
  }

  return Math.max(0, partNumber - 1)
}

async function uploadPart(
  uploadToken: string,
  partNumber: number,
  chunk: Uint8Array,
): Promise<void> {
  const url = new URL("https://openupos.bilivideo.com/video/v2/part/upload")
  url.searchParams.set("upload_token", uploadToken)
  url.searchParams.set("part_number", String(partNumber))

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: Buffer.from(chunk),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Part upload failed for part ${partNumber}: HTTP ${response.status} ${text}`,
    )
  }

  if (text.trim().length === 0) {
    return
  }

  const envelope = parseEnvelope<unknown>(text)
  if (envelope.code !== 0) {
    throw new Error(
      `Part upload failed for part ${partNumber}: (${envelope.code}) ${envelope.message}`,
    )
  }
}

async function completeUpload(uploadToken: string): Promise<void> {
  const url = new URL("https://member.bilibili.com/arcopen/fn/archive/video/complete")
  url.searchParams.set("upload_token", uploadToken)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Video merge failed: HTTP ${response.status} ${text}`)
  }

  const envelope = parseEnvelope<unknown>(text)
  if (envelope.code !== 0) {
    throw new Error(`Video merge failed: (${envelope.code}) ${envelope.message}`)
  }
}

async function requestSignedJson<T>(
  config: BilibiliClientCredentials,
  accessToken: string,
  input: {
    readonly method: "GET" | "POST"
    readonly url: string
    readonly body?: unknown
    readonly query?: Record<string, string | number | undefined>
  },
): Promise<T> {
  const url = new URL(input.url)
  for (const [key, value] of Object.entries(input.query || {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }

  const bodyText = input.body === undefined ? "" : JSON.stringify(input.body)
  const headers = buildSignedHeaders({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken,
    contentType: "application/json",
    bodyTextForMd5: bodyText,
  })

  return requestJsonEnvelope<T>(url.toString(), {
    method: input.method,
    headers,
    body: input.method === "GET" ? undefined : bodyText,
  })
}

async function requestJsonEnvelope<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status} ${text}`)
  }

  const envelope = parseEnvelope<T>(text)
  if (envelope.code !== 0) {
    throw new Error(`Request failed: (${envelope.code}) ${envelope.message}`)
  }

  return envelope.data
}

function parseEnvelope<T>(text: string): OpenApiEnvelope<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON response: ${String(error)}\n${text}`)
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { code?: unknown }).code !== "number" ||
    typeof (parsed as { message?: unknown }).message !== "string"
  ) {
    throw new Error(`Unexpected response shape: ${text}`)
  }

  return parsed as OpenApiEnvelope<T>
}

function createMultipartFileBody(
  fieldName: string,
  filePath: string,
): { body: Uint8Array; contentType: string } {
  const boundary = `----bilibili-mcp-${randomUUID()}`
  const filename = basename(filePath)
  const mimeType = MIME_MAP[extname(filePath).toLowerCase()] || "application/octet-stream"
  const file = readFileSync(filePath)

  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      "",
      "",
    ].join("\r\n"),
    "utf8",
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")

  return {
    body: Buffer.concat([head, file, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function compactObject<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  )
}

export function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt * 1_000).toISOString()
}
